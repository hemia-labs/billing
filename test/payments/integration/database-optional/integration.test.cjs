const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const ModuleLoader = require('node:module');
const { upstreamFixture } = require('./upstream.cjs');
const { projection } = require('./projection.cjs');

// A Node-only entry point must not load any framework, ORM or database driver.
const load = ModuleLoader._load;
ModuleLoader._load = function(name, ...args) {
  if (/^(?:@nestjs\/|typeorm(?:\/|$)|pg(?:\/|$)|mysql2?(?:\/|$))/.test(name)) throw new Error('Unexpected runtime dependency: ' + name);
  return load.call(this, name, ...args);
};
const { createPaymentsClient, createPaymentsReceiver } = require('@hemia/payments');
ModuleLoader._load = load;

test('installed package: Node and Nest without tables, optional MySQL/PostgreSQL subscription copies', async t => {
  const upstream = await upstreamFixture();
  t.after(() => upstream.close());
  const config = { ...upstream.connection, clientSecret: 'fixture-only' };
  const buyer = { organizationId: upstream.organizationId, userId: upstream.userId };
  const input = () => ({ ...buyer, operation: 'checkout', idempotencyKey: randomUUID(), planCode: 'pro', planPriceCode: 'monthly' });
  let savedInput;
  await t.test('plain Node recovers a lost response through a new client without local state', async () => {
    const client = createPaymentsClient(config);
    savedInput = input(); upstream.state.lost = true;
    await assert.rejects(client.attempts.create(savedInput));
    const restarted = createPaymentsClient(config);
    const receipt = await restarted.attempts.get(savedInput.idempotencyKey, buyer);
    assert.equal(receipt.attemptId, savedInput.idempotencyKey);
    assert.equal((await restarted.attempts.retry(receipt.attemptId, buyer)).checkoutId, receipt.checkoutId);
    assert.equal(upstream.state.creates, 1);
    await assert.rejects(restarted.attempts.get(receipt.attemptId, { ...buyer, userId: randomUUID() }), e => e.status === 404);
    await assert.rejects(restarted.attempts.get(receipt.attemptId, { ...buyer, organizationId: randomUUID() }), e => e.status === 404);
    assert.equal(upstream.state.confirms, 0);
  });
  await t.test('default receiver is disabled and license is directly available without a webhook', async () => {
    const receiver = createPaymentsReceiver(config);
    await assert.rejects(receiver.receive({}, {}), e => e.status === 404);
    assert.equal((await createPaymentsClient(config).licenses.resolve(buyer.organizationId)).active, true);
  });
  // TypeORM is intentionally absent from the installed fixture's dependencies.
  require('reflect-metadata');
  const { Module } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  const { PaymentsModule, PaymentsService } = require('@hemia/payments/nestjs');
  async function nest(onSnapshot) {
    class HostModule {}
    Module({ imports: [PaymentsModule.forRootAsync({ useFactory: () => ({ connection: config, clientSecret: 'fixture-only', authorize: async () => ({ organizationId: buyer.organizationId, subjectId: buyer.userId }), ...(onSnapshot ? { onSnapshot } : {}) }) })] })(HostModule);
    const app = await NestFactory.create(HostModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    return { app, service: app.get(PaymentsService), url: `http://127.0.0.1:${app.getHttpServer().address().port}/payments` };
  }
  await t.test('Nest starts and serves attempts/license without DataSource or product payment tables', async () => {
    const running = await nest();
    try {
      assert.equal((await fetch(running.url + '/ready')).status, 200);
      const receipt = await fetch(running.url + '/checkout-attempts/' + savedInput.idempotencyKey);
      assert.equal(receipt.status, 200); assert.equal((await receipt.json()).attemptId, savedInput.idempotencyKey);
      const license = await fetch(running.url + '/license');
      assert.equal(license.status, 200); assert.equal((await license.json()).active, true);
    } finally { await running.app.close(); }
  });
  for (const engine of ['mysql', 'postgres']) {
    const port = Number(process.env[engine === 'postgres' ? 'PAYMENTS_OPTIONAL_PG_PORT' : 'PAYMENTS_OPTIONAL_MYSQL_PORT']);
    assert.ok(Number.isInteger(port) && port >= 1024, 'Use verify.sh disposable database ports');
    const sink = await projection(engine, port);
    t.after(() => sink.close());
    for (const host of ['node', 'nest']) {
      await t.test(`${host} optional ${engine} projection authenticates, synchronizes and ignores concurrent stale revisions`, async () => {
        const receiver = createPaymentsReceiver(config, { onSnapshot: snapshot => sink.apply(snapshot) });
        const running = host === 'nest' ? await nest(snapshot => sink.apply(snapshot)) : null;
        try {
          upstream.state.revision += 10n;
          const headers = { authorization: 'Bearer ' + upstream.issue(), timestamp: String(Math.floor(Date.now() / 1000)) };
          const event = { type: 'billing.license.updated', ...upstream.snapshot(), checkouts: [] };
          async function deliver(payload, auth = headers) {
            if (!running) return receiver.receive(auth, payload);
            const response = await fetch(running.url + '/webhooks/license', { method: 'POST', headers: { authorization: auth.authorization, 'x-billing-timestamp': auth.timestamp, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
            if (!response.ok) throw Object.assign(new Error('Webhook rejected'), { status: response.status });
            return response.json();
          }
          assert.equal((await deliver(event)).applied, true);
          const before = await sink.read(buyer.organizationId, 'fixture');
          assert.equal(before.subscription.id, upstream.subscriptionId);
          assert.equal((await deliver({ ...event, confirmedAt: new Date(Date.now() + 1000).toISOString() })).applied, false);
          assert.equal((await sink.read(buyer.organizationId, 'fixture')).confirmedAt, before.confirmedAt);
          const next = { ...event, revision: String(BigInt(event.revision) + 1n) };
          const older = { ...event, revision: String(BigInt(event.revision) - 1n) };
          await Promise.all([deliver(older), deliver(next), deliver(event)]);
          assert.equal((await sink.read(buyer.organizationId, 'fixture')).revision, next.revision);
          await assert.rejects(deliver({ ...event, productCode: 'another-product' }));
          await assert.rejects(deliver(event, { ...headers, timestamp: '1000000000' }));
          const badToken = headers.authorization.slice(0, -5) + 'wrong';
          await assert.rejects(deliver(event, { ...headers, authorization: badToken }));
          upstream.state.revoked = true;
          await assert.rejects(deliver(event));
          upstream.state.revoked = false;
          upstream.state.revision += 10n;
          assert.equal((await receiver.synchronize(buyer.organizationId)).applied, true);
          const synchronized = await sink.read(buyer.organizationId, 'fixture');
          assert.equal(synchronized.revision, String(upstream.state.revision));
          assert.equal(synchronized.license.active, true);
          assert.equal(upstream.state.creates, 1, 'copy synchronization must never initiate purchases');
          const failed = createPaymentsReceiver(config, { onSnapshot: async () => { throw new Error('host storage unavailable'); } });
          await assert.rejects(failed.receive(headers, event), /host storage unavailable/);
          assert.equal((await createPaymentsClient(config).licenses.resolve(buyer.organizationId)).active, true);
        } finally { upstream.state.revoked = false; if (running) await running.app.close(); }
      });
    }
  }
});
