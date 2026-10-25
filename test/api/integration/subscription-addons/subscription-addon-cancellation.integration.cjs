const {providerRegistry}=require('../../helpers/provider-registry');
const { createRequire } = require('node:module');
const apiRequire = createRequire(require('node:path').resolve(__dirname, '../../../../apps/api/package.json'));
// SQL: TS_NODE_TRANSPILE_ONLY=false node -r ts-node/register test/subscription-addon-cancellation.integration.cjs
// Integration: same command with TEST_DATABASE_PORT pointing at a disposable PostgreSQL database.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DataSource, Table } = apiRequire('typeorm');
const {
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
} = require('../../../../apps/api/src/modules/billing-shared');
const {
  BillingSubscriptionAddonsService,
} = require('../../../../apps/api/src/modules/subscription-addons/billing-subscription-addons.service');

function service(repository, dataSource, paypal, audit, entitlements) {
  return new BillingSubscriptionAddonsService(
    repository,
    null,
    null,
    null,
    audit,
    entitlements,
    providerRegistry(paypal),
    null,
    dataSource,
    null,
  );
}

async function checkSql(ds) {
  let sql;
  const repository = {
    find: async () => [{ id: randomUUID(), pendingEffectiveAt: new Date(0) }],
    findOne: async (options) => {
      sql = ds
        .getRepository(BillingSubscriptionAddonEntity)
        .createQueryBuilder('BillingSubscriptionAddonEntity')
        .setFindOptions(options)
        .getSql();
      return null;
    },
  };
  await service(repository, {
    transaction: (work) => work({ getRepository: () => repository }),
  }).processDueCancellations();
  assert(sql.includes('LEFT JOIN "subscriptions"'));
  assert.equal(
    sql.match(/FOR UPDATE.*$/)?.[0],
    'FOR UPDATE OF "BillingSubscriptionAddonEntity"',
  );
  console.log(
    'PASS actual cancellation FindOptions generate PostgreSQL FOR UPDATE OF the add-on alias only',
  );
}

async function checkPostgres(ds, lockQueries) {
  const runner = ds.createQueryRunner();
  // Fixture tables only: no application migrations, foreign keys, or indexes.
  try {
    for (const entity of [
      BillingSubscriptionEntity,
      BillingSubscriptionAddonEntity,
    ]) {
      await runner.createTable(
        Table.create(ds.getMetadata(entity), ds.driver),
        false,
        false,
        false,
      );
    }
  } finally {
    await runner.release();
  }
  const subscriptions = ds.getRepository(BillingSubscriptionEntity);
  const addons = ds.getRepository(BillingSubscriptionAddonEntity);
  const subscription = await subscriptions.save({
    id: randomUUID(),
    organizationId: randomUUID(),
    billingCustomerId: randomUUID(),
    planId: randomUUID(),
    productCode: 'cancellation-test',
    planCode: 'basic',
    provider: 'paypal',
    status: 'active',
    legalAcceptanceId: 'fixture',
    acceptedAt: new Date(),
    legalSnapshotHash: 'fixture',
  });
  const create = (overrides = {}) =>
    addons.save({
      id: randomUUID(),
      subscriptionId: subscription.id,
      addonId: randomUUID(),
      addonCode: 'seats',
      quantity: 1,
      status: 'scheduled_cancel',
      unitPrice: '10.00',
      currency: 'MXN',
      billingInterval: 'monthly',
      pricingModel: 'per_unit',
      entitlementEffects: {},
      provider: 'paypal',
      providerSubscriptionId: `I-${randomUUID()}`,
      pendingEffectiveAt: new Date(0),
      ...overrides,
    });
  const calls = { get: 0, cancel: 0, audit: [], recalculate: [] };
  let providerStatus = 'ACTIVE';
  let providerGate;
  const paypal = {
    getSubscription: async () => {
      calls.get++;
      if (providerGate) await providerGate;
      return { status: providerStatus };
    },
    cancelSubscription: async () => {
      calls.cancel++;
    },
  };
  const audit = {
    record: async (event) => {
      assert.equal(event.manager.queryRunner.isTransactionActive, true);
      assert.equal(event.organizationId, subscription.organizationId);
      calls.audit.push(event);
    },
  };
  const entitlements = {
    recalculate: async (id) => {
      assert.equal(id, subscription.id);
      calls.recalculate.push(id);
    },
  };
  const worker = () => service(addons, ds, paypal, audit, entitlements);
  const due = await create();
  const future = await create({
    pendingEffectiveAt: new Date(Date.now() + 86400000),
  });
  const already = await create({ status: 'cancelled' });

  // Hold the first transaction in the simulated provider until the second worker
  // attempts its real locking SELECT, forcing contention on the same add-on.
  let releaseProvider;
  let contended = false;
  let timedOut = false;
  providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  lockQueries.onSecond = () => {
    contended = !timedOut;
    releaseProvider();
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    releaseProvider();
  }, 5000);
  try {
    await Promise.all([
      worker().processDueCancellations(),
      worker().processDueCancellations(),
    ]);
  } finally {
    clearTimeout(timeout);
    releaseProvider();
    providerGate = null;
    lockQueries.onSecond = null;
  }
  assert(lockQueries.count >= 2, 'both workers attempted the locking query');
  assert(
    contended,
    'second worker must reach its locking query before provider release',
  );
  assert.equal(
    (await addons.findOneByOrFail({ id: due.id })).status,
    'cancelled',
  );
  assert.equal(
    (await addons.findOneByOrFail({ id: future.id })).status,
    'scheduled_cancel',
  );
  assert.equal(
    (await addons.findOneByOrFail({ id: already.id })).status,
    'cancelled',
  );
  assert.equal(calls.get, 1);
  assert.equal(calls.cancel, 1);
  assert.equal(calls.audit.length, 1);
  assert.equal(calls.recalculate.length, 1);
  await worker().processDueCancellations();
  assert.equal(calls.get, 1, 'repeat worker run is idempotent');

  for (providerStatus of ['CANCELLED', 'EXPIRED']) {
    const terminal = await create();
    await worker().processDueCancellations();
    assert.equal(
      (await addons.findOneByOrFail({ id: terminal.id })).status,
      'cancelled',
    );
  }
  assert.equal(
    calls.cancel,
    1,
    'terminal provider subscriptions are not cancelled again',
  );
  assert.equal(calls.audit.length, 3);
  assert.equal(calls.recalculate.length, 3);
  console.log(
    'PASS PostgreSQL cancellation, two contending workers, related subscription, audit transaction, entitlement refresh, future/terminal add-ons, repeat run and CANCELLED/EXPIRED provider states',
  );
}

async function run() {
  const port = Number(process.env.TEST_DATABASE_PORT);
  const lockQueries = { count: 0, runners: new Set(), onSecond: null };
  const ds = new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port: port || 5432,
    username: 'postgres',
    password: 'isolated-test-only',
    database: 'billing_be002_test',
    entities: [process.cwd() + '/src/**/*.entity.ts'],
    synchronize: false,
    migrationsRun: false,
    logging: ['query'],
    logger: {
      logQuery(sql, parameters, queryRunner) {
        if (sql.includes('FOR UPDATE') && sql.includes('subscription_addons')) {
          lockQueries.runners.add(queryRunner);
          lockQueries.count = lockQueries.runners.size;
          if (lockQueries.count === 2) lockQueries.onSecond?.();
        }
      },
      logQueryError() {},
      logQuerySlow() {},
      logSchemaBuild() {},
      logMigration() {},
      log() {},
    },
  });
  if (!process.env.TEST_DATABASE_PORT) {
    await ds.buildMetadatas();
    await checkSql(ds);
    return;
  }
  assert(Number.isInteger(port) && port > 0);
  await ds.initialize();
  try {
    assert.equal(
      (
        await ds.query(
          "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
        )
      )[0].n,
      0,
      'integration requires an empty disposable database',
    );
    if (!process.argv.includes('--postgres-only')) await checkSql(ds);
    await checkPostgres(ds, lockQueries);
  } finally {
    await ds.destroy();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
