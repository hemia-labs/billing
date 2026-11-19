const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { randomUUID, randomBytes } = require('node:crypto');
const apiRequire = createRequire(require('node:path').resolve(__dirname, '../../../../apps/api/package.json'));
const { ConfigService } = apiRequire('@nestjs/config');
const e = require('../../../../apps/api/src/modules/billing-shared');
const { BillingPaypalConnectionEntity } = require('../../../../apps/api/src/modules/billing-shared/entities/billing-paypal-connection.entity');
const { PaypalConnectionsService } = require('../../../../apps/api/src/modules/paypal-connections/paypal-connections.service');
const { PaypalConnectionCrypto } = require('../../../../apps/api/src/modules/paypal-connections/paypal-connection.crypto');
const { PaypalClientService } = require('../../../../apps/api/src/modules/paypal/paypal-client.service');
const { PaypalBillingAdapter } = require('../../../../apps/api/src/modules/providers/paypal-billing.adapter');
const { BillingProviderRegistry } = require('../../../../apps/api/src/modules/providers/billing-provider.registry');
const { BillingCheckoutService } = require('../../../../apps/api/src/modules/checkout/billing-checkout.service');
const { BillingCatalogService } = require('../../../../apps/api/src/modules/catalog/billing-catalog.service');
const { BillingPlanCatalogResolver } = require('../../../../apps/api/src/modules/catalog/billing-plan-catalog.resolver');
const { BillingAuditService } = require('../../../../apps/api/src/modules/audit/billing-audit.service');
const { BillingServicePolicyService } = require('../../../../apps/api/src/common/services/billing-service-policy.service');
const { BillingServiceClientRegistryService } = require('../../../../apps/api/src/common/services/billing-service-client-registry.service');
const { BillingServiceClientEntity } = require('../../../../apps/api/src/common/entities/billing-service-client.entity');
const { BillingWebhooksService } = require('../../../../apps/api/src/modules/webhooks/billing-webhooks.service');
const { BillingSubscriptionPaymentsProcessorService } = require('../../../../apps/api/src/modules/webhooks/paypal/billing-subscription-payments-processor.service');
const { BillingPaypalRefundsService } = require('../../../../apps/api/src/modules/webhooks/paypal/billing-paypal-refunds.service');
const { PaypalRefundRecoveryService } = require('../../../../apps/api/src/modules/webhooks/paypal/paypal-refund-recovery.service');
const { providerConnectionWhere } = require('../../../../apps/api/src/modules/providers/provider-connection');
const { webhookOrganizationSql } = require('../../../../apps/api/src/modules/webhooks/webhook-organization.sql');

// All records and PayPal responses are isolated test fixtures. Never contacts PayPal.
module.exports = async function checkProductPaypalRuntime(ds) {
  const originalFetch = global.fetch;
  const suffix = randomUUID();
  const codes = [`app-a-${suffix}`, `app-b-${suffix}`];
  const config = new ConfigService({
    app: { nodeEnv: 'test', globalPrefix: 'api/v1' },
    auth: { requiredIssuer: 'https://identity.test' },
    paypalConnections: { encryptionKey: randomBytes(32).toString('base64') },
    paypal: { environment: 'sandbox', baseUrl: 'https://api-m.sandbox.paypal.com' },
  });
  const connections = new PaypalConnectionsService(ds.getRepository(BillingPaypalConnectionEntity), ds.getRepository(e.BillingProductEntity), new PaypalConnectionCrypto(config), config);
  const catalog = new BillingCatalogService(...['BillingProductEntity', 'BillingPlanEntity', 'BillingPlanVersionEntity', 'BillingPlanPriceEntity', 'BillingProviderPriceEntity', 'BillingFeatureDefinitionEntity', 'BillingPlanEntitlementEntity', 'BillingAddonEntity', 'BillingSubscriptionEntity', 'BillingSubscriptionAddonEntity'].map((name) => ds.getRepository(e[name])), new BillingPlanCatalogResolver(),
    {resolveConnection:async()=>null});
  const products = [], plans = [], ids = [], organizations = [randomUUID(), randomUUID()];
  for (const [i, code] of codes.entries()) {
    const [product] = await ds.query('INSERT INTO products(code,name) VALUES($1,$1) RETURNING id', [code]);
    products.push(product);
    const draftState = await connections.save(product.id, { name: `App ${i}`, environment: 'sandbox', clientId: `client-${i}`, clientSecret: `secret-${i}`, webhookId: `WH-${i}` });
    const activeState = await connections.activate(product.id, draftState.draft.id, { expectedUpdatedAt: draftState.draft.updatedAt.toISOString(), expectedCurrentConnectionId: null, expectedCurrentUpdatedAt: null });
    ids.push(activeState.connection.id);
    const plan = await catalog.createPlan({ productId: product.id, code: 'basic', name: 'Basic', version: { version: 1, prices: [{ code: 'monthly', billingInterval: 'month', currency: 'MXN', amount: '100.00', providerPrices: [{ provider: 'paypal', connectionScope:'connection', providerConnectionId:ids[i], providerPriceId: 'P-SAME' }] }] } });
    const [version] = await ds.query('SELECT id FROM plan_versions WHERE plan_id=$1', [plan.id]);
    await catalog.publishVersion(version.id);
    plans.push(plan);
  }
  const actor = { issuer: 'https://identity.test', clientId: `runtime-${suffix}` };
  await ds.query('INSERT INTO billing_service_clients(client_id,policy) VALUES($1,$2)', [actor.clientId, { enabled: true, products: codes, organizationScope: 'all_for_allowed_products', allowedReturnOrigins: ['https://checkout.test'], allowSharedCheckouts: false }]);
  const paypal = new PaypalClientService(config, connections);
  const audit = new BillingAuditService(ds.getRepository(e.BillingAuditLogEntity));
  const checkouts = ds.getRepository(e.BillingCheckoutSessionEntity);
  const checkout = new BillingCheckoutService(ds, {}, new BillingProviderRegistry(new PaypalBillingAdapter(paypal)), audit, checkouts, ds.getRepository(e.BillingSubscriptionEntity), new BillingPlanCatalogResolver(), new BillingServicePolicyService(config, new BillingServiceClientRegistryService(ds.getRepository(BillingServiceClientEntity))));
  const sent = [], resends = [];
  let recovery = false;
  global.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers), body = init.body ? JSON.parse(init.body === 'grant_type=client_credentials' ? '{}' : String(init.body)) : {};
    if (String(url).endsWith('/oauth2/token')) {
      const credentials = Buffer.from(headers.get('authorization').slice(6), 'base64').toString();
      return new Response(JSON.stringify({ access_token: `token:${credentials}`, expires_in: 3600 }));
    }
    if (String(url).endsWith('/v1/billing/subscriptions') && init.method === 'POST') {
      const persisted = await checkouts.findOneByOrFail({ id: body.custom_id });
      const index = ids.indexOf(persisted.metadata.providerConnectionId);
      assert(index >= 0, 'provider call must happen only after the connection pin commits');
      assert.equal(headers.get('authorization'), `Bearer token:client-${index}:secret-${index}`);
      sent.push(persisted.metadata.providerConnectionId);
      return new Response(JSON.stringify({ id: 'I-SAME', status: 'APPROVAL_PENDING', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/approve' }] }));
    }
    if (String(url).includes('verify-webhook-signature')) {
      const index = body.webhook_id === 'WH-0' ? 0 : 1;
      assert.equal(headers.get('authorization'), `Bearer token:client-${index}:secret-${index}`);
      return new Response(JSON.stringify({ verification_status: 'SUCCESS' }));
    }
    if (recovery && String(url).includes('/webhooks-events')) {
      if (init.method === 'POST') {
        resends.push(body.webhook_ids[0]);
        return new Response('{}', { status: 202 });
      }
      const type = new URL(String(url)).searchParams.get('event_type');
      return new Response(JSON.stringify({ events: type === 'PAYMENT.SALE.REFUNDED' ? [{ id: 'WH-MISSING-SAME', event_type: type, resource: { sale_id: 'CAP-SAME' } }] : [] }));
    }
    throw new Error('Unexpected isolated PayPal request: ' + url);
  };
  try {
    const receipts = [];
    for (const [i, code] of codes.entries()) receipts.push(await checkout.createCheckoutSession({ idempotencyKey: randomUUID(), organizationId: organizations[i], userId: randomUUID(), productCode: code, planCode: 'basic', planPriceCode: 'monthly', successUrl: 'https://checkout.test/success', cancelUrl: 'https://checkout.test/cancel' }, actor));
    assert.deepEqual(sent, ids);
    for (const [i, receipt] of receipts.entries()) {
      const subscription = await ds.getRepository(e.BillingSubscriptionEntity).findOneByOrFail({ id: receipt.subscriptionId });
      assert.equal(subscription.metadata.providerConnectionId, ids[i]);
      assert.equal(subscription.providerSubscriptionId, 'I-SAME');
    }
    const webhooks = new BillingWebhooksService(ds, paypal, audit, ds.getRepository(e.BillingWebhookEventEntity), ds.getRepository(e.BillingAuditLogEntity), { recover() {} });
    const headers = { transmissionId: 'tx', transmissionTime: 'now', certUrl: 'https://api.paypal.com/cert', authAlgo: 'SHA256', transmissionSig: 'sig' };
    const payload = { id: 'WH-SAME', event_type: 'BILLING.SUBSCRIPTION.CREATED', resource: { id: 'I-SAME' } };
    for (const id of ids) await webhooks.processPaypalWebhook(headers, payload, id);
    await webhooks.processPaypalWebhook(headers, payload, ids[0]);
    const events = await ds.query('SELECT w.id,w.provider_connection_id,' + webhookOrganizationSql('w') + ' AS organization_id FROM webhook_events w WHERE provider_event_id=$1 ORDER BY provider_connection_id', ['WH-SAME']);
    assert.equal(events.length, 2, 'event id is deduplicated per connection');
    for (const event of events) assert.equal(event.organization_id, organizations[ids.indexOf(event.provider_connection_id)]);
    const listed = await webhooks.listConsoleWebhooks({ page: 1, limit: 25, provider_event_id: 'WH-SAME' }, [organizations[0]]);
    assert.equal(listed.total, 1);
    const eventA = events.find((event) => event.provider_connection_id === ids[0]);
    await ds.query("UPDATE webhook_events SET processing_status='failed' WHERE id=$1", [eventA.id]);
    await assert.rejects(webhooks.retryWebhook(eventA.id, 'wrong owner', randomUUID(), [organizations[1]]), (error) => error.status === 403);
    await webhooks.retryWebhook(eventA.id, 'owner retry', randomUUID(), [organizations[0]]);

    const processor = new BillingSubscriptionPaymentsProcessorService(paypal, {}, audit);
    const at = { eventId: eventA.id, providerEventId: 'WH-SAME', eventType: 'BILLING.SUBSCRIPTION.CREATED', resource: { id: 'I-SAME' }, providerConnectionId: ids[0] };
    await ds.transaction((manager) => processor.process(manager, at, { paypalSubscription: { id: 'I-SAME', status: 'ACTIVE', raw: { id: 'I-SAME' } } }));
    assert.equal((await ds.getRepository(e.BillingSubscriptionEntity).findOneByOrFail({ id: receipts[0].subscriptionId })).status, 'active');
    assert.equal((await ds.getRepository(e.BillingSubscriptionEntity).findOneByOrFail({ id: receipts[1].subscriptionId })).status, 'pending');

    const payments = [];
    for (const i of [0, 1]) {
      const payment = await ds.getRepository(e.BillingPaymentEntity).save({ organizationId: organizations[i], subscriptionId: receipts[i].subscriptionId, provider: 'paypal', providerCaptureId: 'CAP-SAME', amount: '100.00', currency: 'MXN', status: 'paid', metadata: { providerConnectionId: ids[i] } });
      payments.push(payment);
      assert.equal((await ds.getRepository(e.BillingPaymentEntity).findOne({ where: { providerCaptureId: 'CAP-SAME', metadata: providerConnectionWhere(ids[i]) } })).id, payment.id);
    }
    const refunds = new BillingPaypalRefundsService(audit);
    for (const i of [0, 1]) await ds.transaction((manager) => refunds.process(manager, { eventId: events.find((event) => event.provider_connection_id === ids[i]).id, providerEventId: 'REFUND-SAME', providerConnectionId: ids[i], eventType: 'PAYMENT.SALE.REFUNDED', resource: { id: 'R-SAME', sale_id: 'CAP-SAME', amount: { total: '10.00', currency: 'MXN' }, state: 'completed' } }));
    assert.equal(await ds.getRepository(e.BillingPaymentRefundEntity).count({ where: { providerRefundId: 'R-SAME' } }), 2);
    assert.equal(await ds.getRepository(e.BillingPaymentEntity).findOne({ where: { providerCaptureId: 'CAP-SAME', metadata: providerConnectionWhere(null) } }), null);
    recovery = true;
    await new PaypalRefundRecoveryService(ds, paypal, config).recover();
    assert.deepEqual(resends.sort(), ['WH-0', 'WH-1']);
    for (const i of [0, 1]) {
      await ds.getRepository(e.BillingPaymentEntity).update(payments[i].id, { periodStart: new Date(Date.now() - 60000), periodEnd: new Date(Date.now() + 86400000) });
      await ds.transaction((manager) => refunds.process(manager, { eventId: events.find((event) => event.provider_connection_id === ids[i]).id, providerEventId: 'REFUND-FULL-SAME', providerConnectionId: ids[i], eventType: 'PAYMENT.SALE.REFUNDED', resource: { id: 'R-FULL-SAME', sale_id: 'CAP-SAME', amount: { total: '90.00', currency: 'MXN' }, state: 'completed' } }));
    }
    const jobs = await ds.query('SELECT target_subscription_id FROM paypal_cancellation_jobs WHERE target_subscription_id=ANY($1::uuid[])', [receipts.map((receipt) => receipt.subscriptionId)]);
    assert.equal(jobs.length, 2, 'same provider id in two apps retains two cancellation targets');
    console.log('PASS product PayPal runtime: committed pins, two apps same subscription/event/capture/refund ids, scoped ownership/list/retry, payment isolation and recovery SQL across connections');
  } finally { global.fetch = originalFetch; }
};
