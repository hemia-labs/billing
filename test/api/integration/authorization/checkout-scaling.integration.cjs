const { createRequire } = require('node:module');
const apiRequire = createRequire(require('node:path').resolve(__dirname, '../../../../apps/api/package.json'));
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = apiRequire('@nestjs/config');
const entities = require('../../../../apps/api/src/modules/billing-shared');
const {
  BillingCheckoutService,
} = require('../../../../apps/api/src/modules/checkout/billing-checkout.service');
const {
  BillingAuditService,
} = require('../../../../apps/api/src/modules/audit/billing-audit.service');
const {
  BillingPlanCatalogResolver,
} = require('../../../../apps/api/src/modules/catalog/billing-plan-catalog.resolver');
const {
  BillingServicePolicyService,
} = require('../../../../apps/api/src/common/services/billing-service-policy.service');
const {
  parseBillingServicePolicy,
} = require('../../../../apps/api/src/common/types/billing-service-policy');
const {
  CheckoutIdempotencyIndexes1790899200000,
} = require('../../../../apps/api/src/database/migrations/1790899200000-checkout-idempotency-indexes');

// Called by the disposable PostgreSQL harness after all migrations have run.
module.exports = async function checkCheckoutScaling(ds) {
  const organizationId = randomUUID(),
    productCode = `checkout-${randomUUID()}`;
  const [product] = await ds.query(
    'INSERT INTO products(code,name) VALUES($1,$1) RETURNING id',
    [productCode],
  );
  const [plan] = await ds.query(
    "INSERT INTO plans(product_id,code,name,status) VALUES($1,'basic','Basic','active') RETURNING id",
    [product.id],
  );
  const [version] = await ds.query(
    "INSERT INTO plan_versions(plan_id,version,status) VALUES($1,1,'published') RETURNING id",
    [plan.id],
  );
  const [price] = await ds.query(
    "INSERT INTO plan_prices(plan_version_id,code,billing_interval,currency,amount) VALUES($1,'monthly','month','MXN',100) RETURNING id",
    [version.id],
  );
  await ds.query(
    "INSERT INTO provider_prices(plan_price_id,provider,provider_price_id) VALUES($1,'paypal','P-TEST')",
    [price.id],
  );
  const actor = { issuer: 'https://identity.test', clientId: 'checkout-test' };
  const policy = {
    products: [productCode],
    organizationScope: 'all_for_allowed_products',
    allowedReturnOrigins: ['https://checkout.test'],
  };
  const clients = { [actor.clientId]: parseBillingServicePolicy(policy), 'other-client': parseBillingServicePolicy(policy) };
  for(const [clientId, value] of Object.entries(clients)) await ds.query('INSERT INTO billing_service_clients(client_id,policy) VALUES($1,$2)', [clientId,value]);
  const {BillingServiceClientEntity}=require('../../../../apps/api/src/common/entities/billing-service-client.entity');
  const {BillingServiceClientRegistryService}=require('../../../../apps/api/src/common/services/billing-service-client-registry.service');
  const {BillingServiceClientsService}=require('../../../../apps/api/src/modules/integrations/service-clients/billing-service-clients.service');
  const catalogActor={...actor,clientId:'catalog-only-test'};
  const catalogPolicy={enabled:true,products:[productCode],organizationScope:'organizations',organizationIds:[],allowedReturnOrigins:[]};
  const catalogConfig=new ConfigService({app:{nodeEnv:'test'},auth:{requiredIssuer:actor.issuer}});
  let effectiveScopes=['billing.integration.catalog.read'];
  const catalogRegistry=new BillingServiceClientRegistryService(ds.getRepository(BillingServiceClientEntity));
  const catalogAuthorization=new BillingServicePolicyService(catalogConfig,catalogRegistry);
  const administration=new BillingServiceClientsService(ds.getRepository(BillingServiceClientEntity),ds.getRepository(entities.BillingProductEntity),catalogConfig,new BillingAuditService(ds.getRepository(entities.BillingAuditLogEntity)),{billingScopes:async()=>effectiveScopes});
  await administration.save(catalogActor.clientId,catalogPolicy,organizationId,'console-test');
  const storedAuthorization=await catalogAuthorization.resolve(catalogActor);
  catalogAuthorization.assertProduct(storedAuthorization,productCode);
  assert.throws(()=>catalogAuthorization.assertOrganization(storedAuthorization,organizationId),error=>error.status===403);
  effectiveScopes=['billing.integration.licenses.read'];
  await assert.rejects(administration.save(catalogActor.clientId,catalogPolicy,organizationId,'console-test'),error=>error.status===400);
  assert.deepEqual((await catalogRegistry.findPolicy(catalogActor.clientId)).organizationIds,[]);
  console.log('PASS catalog-only policy persisted with no organizations or returns; organization access denied and scoped-operation upgrade rejected');
  let calls = 0;
  const provider = {
    createSubscription: async ({ requestId }) => {
      calls++;
      return {
        id: `I-${requestId}`,
        approvalUrl: 'https://paypal.test/approve',
      };
    },
  };
  const checkouts = ds.getRepository(entities.BillingCheckoutSessionEntity);
  const customers = ds.getRepository(entities.BillingCustomerEntity);
  const service = new BillingCheckoutService(
    ds,
    {
      validateAcceptance: async (input) => ({
        ...input,
        acceptedAt: new Date().toISOString(),
        legalSnapshotHash: 'a'.repeat(64),
      }),
    },
    provider,
    new BillingAuditService(ds.getRepository(entities.BillingAuditLogEntity)),
    checkouts,
    ds.getRepository(entities.BillingSubscriptionEntity),
    new BillingPlanCatalogResolver(),
    new BillingServicePolicyService(
      new ConfigService({
        app: { nodeEnv: 'production' },
        auth: { requiredIssuer: actor.issuer },
      }),
      new (require('../../../../apps/api/src/common/services/billing-service-client-registry.service').BillingServiceClientRegistryService)(ds.getRepository(require('../../../../apps/api/src/common/entities/billing-service-client.entity').BillingServiceClientEntity)),
    ),
  );
  const input = {
    idempotencyKey: randomUUID(),
    organizationId,
    userId: randomUUID(),
    productCode,
    planCode: 'basic',
    planPriceCode: 'monthly',
    provider: 'paypal',
    legalAcceptanceId: randomUUID(),
    successUrl: 'https://checkout.test/success',
    cancelUrl: 'https://checkout.test/cancel',
    billingEmail: 'test@checkout.test',
  };
  await assert.rejects(service.createCheckoutSession(input,catalogActor),error=>error.status===403);
  assert.equal(calls,0);
  const responses = await Promise.all(
    Array.from({ length: 12 }, () =>
      service.createCheckoutSession(
        { ...input, idempotencyKey: randomUUID() },
        actor,
      ),
    ),
  );
  assert.equal(new Set(responses.map((result) => result.checkoutId)).size, 12);
  assert.equal(
    await customers.countBy({ organizationId, provider: 'paypal' }),
    1,
  );
  assert.equal(calls, 12);

  const retries = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      service.createCheckoutSession(input, actor),
    ),
  );
  const complete = retries.filter((result) => result.status === 'fulfilled');
  assert(complete.length > 0);
  for (const result of retries) {
    if (result.status === 'fulfilled')
      assert.equal(result.value.checkoutId, complete[0].value.checkoutId);
    else assert.equal(result.reason.response.code, 'CHECKOUT_IN_PROGRESS');
  }
  assert.equal(calls, 13);
  assert.equal(
    (await service.createCheckoutSession(input, actor)).checkoutId,
    complete[0].value.checkoutId,
  );
  const other = await service.createCheckoutSession(input, {
    ...actor,
    clientId: 'other-client',
  });
  assert.notEqual(other.checkoutId, complete[0].value.checkoutId);
  const original = await checkouts.findOneByOrFail({
    id: complete[0].value.checkoutId,
  });
  const copy = () => ({ ...original, id: randomUUID() });
  await assert.rejects(
    checkouts.save(copy()),
    (error) =>
      error.driverError?.constraint ===
      'UQ_checkout_sessions_service_idempotency',
  );
  await checkouts.softDelete(original.id);
  await assert.rejects(
    service.createCheckoutSession(input, actor),
    (error) => error.status === 409,
  );
  await assert.rejects(
    checkouts.save(copy()),
    (error) =>
      error.driverError?.constraint ===
      'UQ_checkout_sessions_service_idempotency',
  );

  const runner = ds.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await runner.query('SET LOCAL enable_seqscan = off');
    const explain = await runner.query(
      "EXPLAIN SELECT id FROM checkout_sessions WHERE organization_id=$1 AND metadata ->> 'createdByIssuer'=$2 AND metadata ->> 'createdByClientId'=$3 AND metadata ->> 'idempotencyKey'=$4",
      [organizationId, actor.issuer, actor.clientId, input.idempotencyKey],
    );
    assert(
      JSON.stringify(explain).includes(
        'UQ_checkout_sessions_service_idempotency',
      ),
    );
    await runner.rollbackTransaction();

    const migration = new CheckoutIdempotencyIndexes1790899200000();
    for (const kind of ['active_customers', 'checkout_keys']) {
      await runner.startTransaction();
      await migration.down(runner);
      if (kind === 'active_customers')
        await runner.manager
          .getRepository(entities.BillingCustomerEntity)
          .insert({ organizationId, provider: 'paypal', status: 'active' });
      else
        await runner.manager
          .getRepository(entities.BillingCheckoutSessionEntity)
          .save(copy());
      await assert.rejects(migration.up(runner), (error) =>
        error.message.includes(`duplicate ${kind}`),
      );
      await runner.rollbackTransaction();
    }
    await runner.startTransaction();
    await migration.down(runner);
    await migration.up(runner);
    await runner.rollbackTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  console.log(
    'PASS concurrent customer creation, independent checkout keys, indexed lookup, same-key retries, namespace and soft-delete uniqueness, migration duplicate preflight and rollback',
  );
};
