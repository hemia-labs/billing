const { createRequire } = require('node:module');
const apiRequire = createRequire(require('node:path').resolve(__dirname, '../../../../apps/api/package.json'));
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = apiRequire('@nestjs/config');
const entities = require('../../../../apps/api/src/modules/billing-shared');
const { BillingCatalogService } = require('../../../../apps/api/src/modules/catalog/billing-catalog.service');
const { BillingPlanCatalogResolver } = require('../../../../apps/api/src/modules/catalog/billing-plan-catalog.resolver');
const { BillingCheckoutService } = require('../../../../apps/api/src/modules/checkout/billing-checkout.service');
const { BillingAuditService } = require('../../../../apps/api/src/modules/audit/billing-audit.service');
const { BillingServicePolicyService } = require('../../../../apps/api/src/common/services/billing-service-policy.service');
const { BillingServiceClientRegistryService } = require('../../../../apps/api/src/common/services/billing-service-client-registry.service');
const { BillingServiceClientEntity } = require('../../../../apps/api/src/common/entities/billing-service-client.entity');
const { providerRegistry } = require('../../helpers/provider-registry');

// Invoked only by the disposable PostgreSQL authorization harness.
module.exports = async function checkPlanDeletion(ds) {
  const catalogFor = (manager) => new BillingCatalogService(
    ...['BillingProductEntity', 'BillingPlanEntity', 'BillingPlanVersionEntity',
      'BillingPlanPriceEntity', 'BillingProviderPriceEntity', 'BillingFeatureDefinitionEntity',
      'BillingPlanEntitlementEntity', 'BillingAddonEntity', 'BillingSubscriptionEntity',
      'BillingSubscriptionAddonEntity'].map((name) => manager.getRepository(entities[name])),
    new BillingPlanCatalogResolver(),
    {resolveConnection:async()=>null},
  );
  const catalog = catalogFor(ds.manager);
  const productCode = `delete-${randomUUID()}`;
  const [product] = await ds.query('INSERT INTO products(code,name) VALUES($1,$1) RETURNING id', [productCode]);
  const plan = async () => {
    const created = await catalog.createPlan({
      productId: product.id, code: randomUUID(), name: 'Disposable plan',
      version: { version: 1, prices: [{
        code: 'monthly', billingInterval: 'month', billingIntervalCount: 1,
        currency: 'MXN', amount: '100.00',
        providerPrices: [{ provider: 'paypal', connectionScope:'global', providerConnectionId:null, providerPriceId: 'P-TEST' }],
      }] },
    });
    const [version] = await ds.query('SELECT id FROM plan_versions WHERE plan_id=$1', [created.id]);
    await catalog.publishVersion(version.id);
    return { ...created, versionId: version.id };
  };
  const unused = await plan();
  await catalog.deletePlan(unused.id);
  assert.equal(await ds.getRepository(entities.BillingPlanEntity).findOneBy({ id: unused.id }), null);
  assert.equal(await ds.getRepository(entities.BillingPlanVersionEntity).countBy({ planId: unused.id }), 1);
  for (const mutation of [
    () => catalog.deletePlan(unused.id),
    () => catalog.updatePlan(unused.id, { name: 'Revived' }),
    () => catalog.createVersion(unused.id, { version: 2, prices: [] }),
    () => catalog.updateVersion(unused.versionId, {}),
    () => catalog.publishVersion(unused.versionId),
  ]) await assert.rejects(mutation, (error) => error.status === 404);

  const pending = await plan();
  await ds.query(`INSERT INTO payment_attempts(id,organization_id,user_id,product_code,created_by_issuer,created_by_client_id,request_hash,request_payload,status)
    VALUES($1,$2,$3,$4,'https://identity.test','test','hash',$5,'pending')`,
  [randomUUID(), randomUUID(), randomUUID(), productCode, { planCode: pending.code }]);
  await assert.rejects(catalog.deletePlan(pending.id), (error) => error.status === 409);

  const actor = { issuer: 'https://identity.test', clientId: `delete-test-${randomUUID()}` };
  await ds.query('INSERT INTO billing_service_clients(client_id,policy) VALUES($1,$2)', [actor.clientId, {
    enabled: true, products: [productCode], organizationScope: 'all_for_allowed_products',
    allowedReturnOrigins: ['https://checkout.test'], allowSharedCheckouts: false,
  }]);
  let providerCalls = 0;
  const checkout = new BillingCheckoutService(
    ds, {}, providerRegistry({ createSubscription: async ({ requestId }) => {
      providerCalls++;
      return { id: `I-${requestId}`, approvalUrl: 'https://www.sandbox.paypal.com/approve' };
    } }),
    new BillingAuditService(ds.getRepository(entities.BillingAuditLogEntity)),
    ds.getRepository(entities.BillingCheckoutSessionEntity),
    ds.getRepository(entities.BillingSubscriptionEntity), new BillingPlanCatalogResolver(),
    new BillingServicePolicyService(new ConfigService({ app: { nodeEnv: 'test' }, auth: { requiredIssuer: actor.issuer } }),
      new BillingServiceClientRegistryService(ds.getRepository(BillingServiceClientEntity))),
  );
  const input = (target) => ({
    idempotencyKey: randomUUID(), organizationId: randomUUID(), userId: randomUUID(),
    productCode, planCode: target.code, planPriceCode: 'monthly', provider: 'paypal',
    successUrl: 'https://checkout.test/success', cancelUrl: 'https://checkout.test/cancel',
  });
  const used = await plan();
  const receipt = await checkout.createCheckoutSession(input(used), actor);
  await ds.getRepository(entities.BillingSubscriptionEntity).update(receipt.subscriptionId, { status: 'cancelled' });
  await ds.getRepository(entities.BillingSubscriptionEntity).softDelete(receipt.subscriptionId);
  await ds.getRepository(entities.BillingCheckoutSessionEntity).softDelete(receipt.checkoutId);
  await assert.rejects(catalog.deletePlan(used.id), (error) => error.status === 409);

  const concurrent = await plan();
  const runner = ds.createQueryRunner();
  await runner.connect();
  let purchase;
  try {
    await runner.startTransaction();
    await catalogFor(runner.manager).deletePlan(concurrent.id);
    // The soft delete is uncommitted: ordinary reads still see the active plan.
    const before = providerCalls;
    purchase = checkout.createCheckoutSession(input(concurrent), actor);
    // Attach a handler immediately while coordinating the blocked checkout.
    const rejection = assert.rejects(purchase, (error) => error.status === 404);
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [state] = await ds.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE%') AS blocked");
      if (state.blocked) { blocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(blocked, 'checkout must wait on the plan shared lock while delete is uncommitted');
    await runner.commitTransaction();
    await rejection;
    assert.equal(providerCalls, before, 'a deleted plan never reaches the payment provider');
    assert.equal(await ds.getRepository(entities.BillingSubscriptionEntity).countBy({ planId: concurrent.id }), 0);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    if (purchase) await purchase.catch(() => {});
  }
  console.log('PASS plan soft deletion, retained versions, deleted-parent mutation denial, pending and soft-deleted billing history guards, concurrent checkout rejects before provider');
};
