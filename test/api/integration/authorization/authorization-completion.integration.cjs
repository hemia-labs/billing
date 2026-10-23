const { createRequire } = require('node:module');
const apiRequire = createRequire(require('node:path').resolve(__dirname, '../../../../apps/api/package.json'));
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DataSource } = apiRequire('typeorm');
const entities = require('../../../../apps/api/src/modules/billing-shared');
const {
  BillingInvoicesService,
} = require('../../../../apps/api/src/modules/invoices/billing-invoices.service');
const {
  BillingAuditService,
} = require('../../../../apps/api/src/modules/audit/billing-audit.service');
const {
  BillingCatalogService,
} = require('../../../../apps/api/src/modules/catalog/billing-catalog.service');
const {
  BillingPlanCatalogResolver,
} = require('../../../../apps/api/src/modules/catalog/billing-plan-catalog.resolver');
const {
  webhookOrganizationSql,
} = require('../../../../apps/api/src/modules/webhooks/webhook-organization.sql');
const {
  BillingWebhooksService,
} = require('../../../../apps/api/src/modules/webhooks/billing-webhooks.service');
const port = Number(process.env.TEST_DATABASE_PORT);
assert(Number.isInteger(port) && port > 0);
const ds = new DataSource({
  type: 'postgres',
  host: '127.0.0.1',
  port,
  username: 'postgres',
  password: 'isolated-test-only',
  database: 'billing_corrections_test',
  entities: [process.cwd() + '/src/**/*.entity.ts'],
  migrations: [process.cwd() + '/src/database/migrations/*.ts'],
  synchronize: false,
  migrationsRun: false,
  logging: false,
});
async function run() {
  await ds.initialize();
  assert.equal(
    (
      await ds.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
      )
    )[0].n,
    0,
  );
  await ds.runMigrations({ transaction: 'all' });
  await require('./license-connections.integration.cjs')(ds);
  const org = randomUUID(),
    other = randomUUID();
  const actor = {
    issuer: 'https://identity.test',
    subject: randomUUID(),
    identityReferenceId: randomUUID(),
    traceId: randomUUID(),
  };
  const [payment] = await ds.query(
    "INSERT INTO payments(organization_id,provider,amount,currency,status,provider_capture_id) VALUES($1,'paypal',116,'MXN','paid','capture-1') RETURNING id",
    [org],
  );
  const audit = new BillingAuditService(
    ds.getRepository(entities.BillingAuditLogEntity),
  );
  const invoices = ds.getRepository(entities.BillingInvoiceEntity);
  const invoice = async () =>
    invoices.save(
      invoices.create({
        organizationId: org,
        paymentId: payment.id,
        rfc: 'AAA010101AAA',
        legalName: 'Test',
        taxRegime: '601',
        cfdiUse: 'G03',
        subtotal: '100',
        taxAmount: '16',
        total: '116',
        currency: 'MXN',
        status: 'pending',
        metadata: {},
      }),
    );
  let calls = 0,
    release,
    started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const adapter = {
    issue: async (_invoice, key) => {
      calls++;
      assert(key.endsWith(':issue'));
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      return {
        cfdiUuid: randomUUID(),
        xmlUrl: 'https://test/invoice.xml',
        pdfUrl: 'https://test/invoice.pdf',
        issuedAt: new Date(),
      };
    },
    cancel: async () => ({ providerReference: 'cancelled' }),
  };
  const service = new BillingInvoicesService(
    invoices,
    ds.getRepository(entities.BillingPaymentEntity),
    audit,
    adapter,
  );
  const inv = await invoice();
  const pending = service.issueInvoice(inv.id, actor);
  await began;
  await assert.rejects(
    service.issueInvoice(inv.id, actor),
    (e) => e.status === 409,
  );
  release();
  await pending;
  await service.issueInvoice(inv.id, actor);
  assert.equal(calls, 1);
  const logs = await ds.query('SELECT * FROM audit_logs WHERE resource_id=$1', [
    inv.id,
  ]);
  assert.equal(logs.length, 2);
  assert(
    logs.every(
      (l) =>
        l.actor_user_id === actor.subject &&
        l.metadata.actorIssuer === actor.issuer &&
        l.metadata.actorSubject === actor.subject &&
        l.metadata.traceId === actor.traceId,
    ),
  );
  await service.cancelInvoice(inv.id, actor);
  await service.cancelInvoice(inv.id, actor);
  assert.equal((await invoices.findOneBy({ id: inv.id })).status, 'cancelled');
  const bad = await invoice();
  let attempted = 0;
  const unknown = new BillingInvoicesService(invoices, null, audit, {
    issue: async () => {
      attempted++;
      throw new Error('provider timeout');
    },
    cancel: async () => {},
  });
  await assert.rejects(unknown.issueInvoice(bad.id, actor), /provider timeout/);
  await assert.rejects(
    unknown.issueInvoice(bad.id, actor),
    (e) => e.status === 409,
  );
  assert.equal(attempted, 1);
  await service.markIssued(bad.id, {
    cfdiUuid: randomUUID(),
    xmlUrl: 'https://test/a.xml',
    pdfUrl: 'https://test/a.pdf',
  });
  await service.issueInvoice(bad.id, actor); // Reconciliation makes the completed result replayable.
  const blocked = await invoice();
  let touched = false;
  const broken = new BillingInvoicesService(
    invoices,
    null,
    {
      record: async () => {
        throw new Error('audit down');
      },
    },
    {
      issue: async () => {
        touched = true;
      },
      cancel: async () => {},
    },
  );
  await assert.rejects(broken.issueInvoice(blocked.id, actor), /audit down/);
  assert.equal(touched, false);
  assert.equal(
    (await invoices.findOneBy({ id: blocked.id })).metadata.consoleOperation,
    undefined,
  );
  const [newPayment] = await ds.query(
    "INSERT INTO payments(organization_id,provider,amount,currency,status) VALUES($1,'paypal',116,'MXN','paid') RETURNING id",
    [org],
  );
  const createBody = {
    paymentId: newPayment.id,
    organizationId: org,
    rfc: 'AAA010101AAA',
    legalName: 'Test',
    taxRegime: '601',
    cfdiUse: 'G03',
  };
  const creations = await Promise.allSettled([
    service.createInvoice(createBody),
    service.createInvoice(createBody),
  ]);
  assert.equal(creations.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    creations.find((r) => r.status === 'rejected').reason.status,
    409,
  );
  console.log(
    'PASS invoice reservation, concurrent denial, replay, actor audit, uncertain result, reconciliation and rollback',
  );
  const catalog = new BillingCatalogService(
    ...[
      'BillingProductEntity',
      'BillingPlanEntity',
      'BillingPlanVersionEntity',
      'BillingPlanPriceEntity',
      'BillingProviderPriceEntity',
      'BillingFeatureDefinitionEntity',
      'BillingPlanEntitlementEntity',
      'BillingAddonEntity',
      'BillingSubscriptionEntity',
      'BillingSubscriptionAddonEntity',
    ].map((e) => ds.getRepository(entities[e])),
    new BillingPlanCatalogResolver(),
  );
  const [product] = await ds.query(
    "INSERT INTO products(code,name) VALUES('test','Test') RETURNING id",
  );
  const [plan] = await ds.query(
    "INSERT INTO plans(product_id,code,name) VALUES($1,'test','Test') RETURNING id",
    [product.id],
  );
  await assert.rejects(
    catalog.createPlan({
      productId: product.id,
      code: 'bad',
      name: 'Bad',
      version: { version: 1, status: 'published' },
    }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    catalog.createVersion(plan.id, { version: 1, status: 'published' }),
    (e) => e.status === 400,
  );
  const versions = await ds.query(
    "INSERT INTO plan_versions(plan_id,version,status) VALUES($1,1,'draft'),($1,2,'draft') RETURNING id",
    [plan.id],
  );
  await assert.rejects(
    catalog.updateVersion(versions[0].id, { status: 'published' }),
    (e) => e.status === 400,
  );
  await Promise.all(versions.map((v) => catalog.publishVersion(v.id)));
  assert.equal(
    (
      await ds.query(
        "SELECT count(*)::int AS n FROM plan_versions WHERE plan_id=$1 AND status='published'",
        [plan.id],
      )
    )[0].n,
    1,
  );
  console.log(
    'PASS generic publication blocked and concurrent publications serialized',
  );
  const webhook = async (resource, verified = 'verified') =>
    (
      await ds.query(
        "INSERT INTO webhook_events(provider,provider_event_id,event_type,verification_status,processing_status,payload_json) VALUES('paypal',$1,'PAYMENT.SALE.REFUNDED',$2,'failed',$3) RETURNING id",
        [randomUUID(), verified, JSON.stringify({ resource })],
      )
    )[0].id;
  const owned = await webhook({ id: 'capture-1', organization_id: other });
  const unverified = await webhook({ id: 'capture-1' }, 'failed');
  const unknownWebhook = await webhook({ id: 'unknown', organization_id: org });
  const owner = async (id) =>
    (
      await ds.query(
        `SELECT ${webhookOrganizationSql('w')} AS org FROM webhook_events w WHERE id=$1`,
        [id],
      )
    )[0].org;
  assert.equal(await owner(owned), org);
  assert.equal(await owner(unverified), null);
  assert.equal(await owner(unknownWebhook), null);
  const webhooks = new BillingWebhooksService(
    ds,
    null,
    audit,
    ds.getRepository(entities.BillingWebhookEventEntity),
    ds.getRepository(entities.BillingAuditLogEntity),
  );
  const page = await webhooks.listConsoleWebhooks({ page: 1, limit: 20 }, [
    org,
  ]);
  assert.equal(page.total, 1);
  assert.equal(page.items[0].id, owned);
  await assert.rejects(
    webhooks.retryWebhook(owned, 'test', actor.subject, [other]),
    (e) => e.status === 403,
  );
  await webhooks.retryWebhook(owned, 'test', actor.subject, [org]);
  await ds.query(
    "INSERT INTO payments(organization_id,provider,amount,currency,status,provider_capture_id) VALUES($1,'paypal',116,'MXN','paid','capture-1')",
    [other],
  );
  assert.equal(await owner(owned), null);
  console.log(
    'PASS verified webhook ownership, list scope, retry scope, untrusted metadata and ambiguous mapping',
  );
  await require('./checkout-scaling.integration.cjs')(ds);
}
run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (ds.isInitialized) await ds.destroy();
  });
