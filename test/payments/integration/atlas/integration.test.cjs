const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DataSource } = require('typeorm');
const { startAtlas } = require('./app.cjs');
const { atlasAuthorization } = require('./authorization.cjs');
const { migrate } = require('./migrate.cjs');
const { upstreamFixture } = require('./upstream.fixture.cjs');

// verify.sh supplies a fresh PostgreSQL18 container, never a resident database.
test('installed Nest package runs Atlas with durable retries and authenticated licenses', async (t) => {
  const port = Number(process.env.ATLAS_TEST_PG_PORT);
  assert.ok(Number.isInteger(port) && port >= 15000 && port <= 65535, 'Use verify.sh disposable PostgreSQL');
  const dataSource = new DataSource({ type: 'postgres', host: '127.0.0.1', port, username: 'postgres', password: 'isolated-atlas-only', database: 'atlas_payments_test', synchronize: false, migrationsRun: false });
  await dataSource.initialize();
  const upstream = await upstreamFixture();
  let running;
  t.after(async () => { if (running) await running.app.close(); await upstream.close(); await dataSource.destroy(); });
  const sessionA = { id: randomUUID(), organizationId: randomUUID(), subjectId: randomUUID(), active: true, permissions: ['plans.read', 'checkout.manage', 'license.read'] };
  const sessionB = { ...sessionA, id: randomUUID(), organizationId: randomUUID(), subjectId: randomUUID() };
  const sessions = new Map([['opaque-a', sessionA], ['opaque-b', sessionB]]);
  const webOrigin = 'https://atlas.example.test';
  const options = {
    dataSource, sessions, webOrigin,
    connection: { issuer: upstream.origin, tokenUrl: upstream.origin + '/oauth/token', clientId: 'atlas-backend', baseUrl: upstream.origin + '/api/v1', resource: upstream.origin, audience: 'billing-api', productCode: 'atlas', successUrl: webOrigin + '/payments/success', cancelUrl: webOrigin + '/payments/cancel', allowHttpLoopback: true, requestTimeoutMs: 500, tokenTimeoutMs: 1000 },
    clientSecret: 'fixture-only-atlas-secret',
    receiver: { audience: 'atlas-api', jwksUrl: upstream.origin + '/.well-known/jwks.json', introspectionUrl: upstream.origin + '/oauth/introspect', billingClientId: 'billing-fixture', consoleClientId: 'console-fixture' },
  };
  const authorization = atlasAuthorization(sessions, webOrigin);
  options.authorize = authorization.authorize;
  options.connection.receiver = { audience: options.receiver.audience, billingClientId: options.receiver.billingClientId, consoleClientId: options.receiver.consoleClientId };
  options.connection = JSON.stringify(options.connection);
  delete options.receiver;
  async function api(path, { session = 'opaque-a', method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(running.url + '/payments' + path, { method, headers: { ...(session ? { cookie: `atlas_session=${session}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json', origin: webOrigin }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
  }
  const tables = () => dataSource.query("SELECT to_regclass('payments_checkout_attempts') AS attempts,to_regclass('payments_licenses') AS licenses");
  running = await startAtlas(options);
  running.app.useLogger(['error']);
  await t.test('startup does not migrate; explicit package migration makes readiness succeed', async () => {
    assert.deepEqual(await tables(), [{ attempts: null, licenses: null }]);
    assert.equal((await api('/ready')).status, 503);
    await migrate(dataSource);
    assert.deepEqual(await tables(), [{ attempts: 'payments_checkout_attempts', licenses: 'payments_licenses' }]);
    assert.equal((await api('/ready')).status, 200);
  });
  await t.test('package plans preserve decimals; local sessions and permissions gate user routes', async () => {
    assert.equal((await api('/plans', { session: null })).status, 401);
    const plans = await api('/plans');
    assert.equal(plans.status, 200);
    assert.equal(plans.body[0].code, 'atlas-pro');
    assert.equal(plans.body[0].prices[0].amount, '149.90');
    assert.equal(plans.headers.get('cache-control'), 'no-store');
    sessionA.permissions = [];
    assert.equal((await api('/plans')).status, 403);
    sessionA.permissions = ['plans.read', 'checkout.manage', 'license.read'];
  });
  // Payments-only integration: Atlas manages its own documents.
  const input = { idempotencyKey: randomUUID(), planCode: 'atlas-pro', planPriceCode: 'atlas-monthly' };
  let attempt, ready;
  await t.test('lost upstream response persists pending receipt and retry after app restart reuses payload/key', async () => {
    const first = await api('/checkout-attempts', { method: 'POST', body: input });
    assert.equal(first.status, 202);
    assert.equal(first.body.status, 'pending');
    attempt = first.body.attemptId;
    assert.ok(attempt);
    assert.equal(Object.hasOwn(upstream.state.checkoutRequests[0], 'legalAcceptanceId'), false);
    assert.equal(upstream.orders.size, 1);
    await running.app.close();
    running = await startAtlas(options);
  running.app.useLogger(['error']);
    const stored = await api('/checkout-attempts/' + attempt);
    assert.equal(stored.body.attemptId, attempt);
    ready = await api(`/checkout-attempts/${attempt}/retry`, { method: 'POST', body: {} });
    assert.ok([200, 201].includes(ready.status), JSON.stringify(ready));
    assert.equal(ready.body.status, 'ready');
    assert.equal(ready.body.attemptId, attempt);
    assert.equal(upstream.orders.size, 1);
    assert.equal(upstream.state.checkoutRequests.length, 2);
    assert.deepEqual(upstream.state.checkoutRequests[0], upstream.state.checkoutRequests[1]);
    const repeat = await api('/checkout-attempts', { method: 'POST', body: input });
    assert.equal(repeat.body.attemptId, attempt);
    assert.equal(upstream.state.checkoutRequests.length, 2);
  });
  await t.test('tenant isolation, immutable idempotency and CSRF do not initiate another checkout', async () => {
    const count = upstream.state.checkoutRequests.length;
    assert.equal((await api('/checkout-attempts/' + attempt, { session: 'opaque-b' })).status, 404);
    assert.equal((await api(`/checkout-attempts/${attempt}/retry`, { session: 'opaque-b', method: 'POST', body: {} })).status, 404);
    assert.equal((await api('/checkout-attempts', { method: 'POST', body: { ...input, planCode: 'other' } })).status, 409);
    assert.equal((await api('/checkout-attempts', { method: 'POST', body: input, headers: { origin: 'https://attacker.example.test' } })).status, 403);
    assert.equal((await api('/checkout-attempts', { method: 'POST', body: { ...input, organizationId: sessionB.organizationId } })).status, 400);
    assert.equal(upstream.state.checkoutRequests.length, count);
  });
  const license = { active: true, productCode: 'atlas', subscriptionId: ready?.body.subscriptionId, planCode: 'atlas-pro', licenseStatus: 'active', validUntil: new Date(Date.now() + 86400000).toISOString(), seatsLimit: 3, usageLimit: null, features: { reports: true }, entitlements: { maxUsers: 3, includedUsers: 3, extraUsers: 0, maxAgents: 0, maxConversationsMonthly: null, additional: {}, featureFlags: { reports: true } }, billing: {} };
  const event = { type: 'billing.license.updated', organizationId: sessionA.organizationId, productCode: 'atlas', revision: '2', license, checkouts: [] };
  const delivery = upstream.issue('billing-fixture', 'billing.webhooks.deliver');
  const webhook = (body, token = delivery, timestamp = Math.floor(Date.now() / 1000)) => api('/webhooks/license', { session: null, method: 'POST', body, headers: { authorization: `Bearer ${token}`, 'x-billing-timestamp': String(timestamp) } });
  await t.test('machine routes require correct signature, client, audience, scope, freshness and active introspection', async () => {
    assert.equal((await webhook(event, delivery.slice(0, delivery.lastIndexOf('.') + 1) + (delivery[delivery.lastIndexOf('.') + 1] === 'a' ? 'b' : 'a') + delivery.slice(delivery.lastIndexOf('.') + 2))).status, 401);
    assert.equal((await webhook(event, upstream.issue('wrong-client', 'billing.webhooks.deliver'))).status, 401);
    assert.equal((await webhook(event, upstream.issue('billing-fixture', 'billing.webhooks.deliver', 'wrong-api'))).status, 401);
    assert.equal((await webhook(event, upstream.issue('billing-fixture', 'billing.connections.check'))).status, 401);
    assert.equal((await webhook(event, upstream.issue('billing-fixture', 'billing.webhooks.deliver', 'atlas-api', { iss: 'https://wrong-issuer.test' }))).status, 401);
    assert.equal((await webhook(event, delivery, Math.floor(Date.now() / 1000) - 301)).status, 401);
    upstream.state.revoked = true;
    assert.equal((await webhook(event)).status, 401);
    upstream.state.revoked = false;
    const [count] = await dataSource.query('SELECT count(*)::int AS count FROM payments_licenses');
    assert.equal(count.count, 0);
    assert.equal((await webhook(event)).status, 200);
    assert.equal((await api('/license')).body.active, true);
    assert.equal((await api('/license', { session: 'opaque-b' })).body.active, false);
  });
  await t.test('duplicate and older webhook revisions never overwrite state or refresh confirmation', async () => {
    const [before] = await dataSource.query('SELECT revision,license,confirmed_at,received_at FROM payments_licenses WHERE organization_id=$1 AND product_code=$2', [sessionA.organizationId, 'atlas']);
    assert.equal((await webhook(event)).status, 200);
    assert.equal((await webhook({ ...event, revision: '1', license: { ...license, active: false, licenseStatus: 'revoked' } })).status, 200);
    const [after] = await dataSource.query('SELECT revision,license,confirmed_at,received_at FROM payments_licenses WHERE organization_id=$1 AND product_code=$2', [sessionA.organizationId, 'atlas']);
    assert.deepEqual(after, before);
    assert.equal((await webhook({ ...event, revision: '3', license: { ...license, active: false, licenseStatus: 'revoked' } })).status, 200);
    assert.equal((await api('/license')).body.active, false);
  });
  await t.test('an approved webhook before checkout response is repaired on read without refreshing the license', async () => {
    upstream.state.beforeCheckoutResponse = async (order) => {
      order.remoteStatus = { checkoutStatus: 'approved', subscriptionStatus: 'active' };
      assert.equal((await webhook({
        ...event, revision: '4',
        license: { ...license, subscriptionId: order.result.subscriptionId },
        checkouts: [{ checkoutId: order.result.checkoutId, subscriptionId: order.result.subscriptionId, ...order.remoteStatus }],
      })).status, 200);
    };
    const created = await api('/checkout-attempts', { method: 'POST', body: { ...input, idempotencyKey: randomUUID() } });
    delete upstream.state.beforeCheckoutResponse;
    assert.equal(created.status, 200);
    assert.equal(created.body.checkoutStatus, 'pending');
    const path = '/checkout-attempts/' + created.body.attemptId;
    const statusCalls = () => upstream.state.requests.filter((url) => url.endsWith('/status')).length;
    const previousCalls = statusCalls();
    assert.equal((await api(path, { session: 'opaque-b' })).status, 404);
    assert.equal(statusCalls(), previousCalls);
    const [before] = await dataSource.query('SELECT confirmed_at FROM payments_licenses WHERE organization_id=$1 AND product_code=$2', [sessionA.organizationId, 'atlas']);
    const recovered = await api(path);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.checkoutStatus, 'approved');
    assert.equal(recovered.body.subscriptionStatus, 'active');
    assert.equal(recovered.body.statusFresh, true);
    assert.equal(statusCalls(), previousCalls + 1);
    const [after] = await dataSource.query('SELECT confirmed_at FROM payments_licenses WHERE organization_id=$1 AND product_code=$2', [sessionA.organizationId, 'atlas']);
    assert.deepEqual(after, before);
  });
  await t.test('overlapping identical requests share one durable receipt and remote order', async () => {
    const concurrent = { ...input, idempotencyKey: randomUUID() };
    const orderCount = upstream.orders.size;
    const requestCount = upstream.state.checkoutRequests.length;
    let remoteStarted, releaseResponse;
    const started = new Promise((resolve) => { remoteStarted = resolve; });
    const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
    upstream.state.beforeCheckoutResponse = async () => { remoteStarted(); await responseGate; };
    upstream.state.onDuplicateCheckout = releaseResponse;
    const first = api('/checkout-attempts', { method: 'POST', body: concurrent });
    await started;
    const second = api('/checkout-attempts', { method: 'POST', body: concurrent });
    const results = await Promise.all([first, second]);
    delete upstream.state.beforeCheckoutResponse;
    delete upstream.state.onDuplicateCheckout;
    for (const result of results) { assert.equal(result.status, 200); assert.equal(result.body.status, 'ready'); }
    assert.equal(results[0].body.attemptId, results[1].body.attemptId);
    assert.equal(results[0].body.checkoutId, results[1].body.checkoutId);
    assert.equal(upstream.orders.size, orderCount + 1);
    const sent = upstream.state.checkoutRequests.slice(requestCount);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0], sent[1]);
    const [reserved] = await dataSource.query('SELECT count(*)::int AS count FROM payments_checkout_attempts WHERE organization_id=$1 AND product_code=$2 AND idempotency_key=$3', [sessionA.organizationId, 'atlas', concurrent.idempotencyKey]);
    assert.equal(reserved.count, 1);
    sessions.set('opaque-c', { ...sessionA, id: randomUUID(), subjectId: randomUUID() });
    assert.equal((await api('/checkout-attempts', { session: 'opaque-c', method: 'POST', body: concurrent })).status, 409);
    assert.equal((await api('/checkout-attempts', { method: 'POST', body: { ...concurrent, planCode: 'different-plan' } })).status, 409);
    assert.equal(upstream.orders.size, orderCount + 1);
    assert.equal(upstream.state.checkoutRequests.length, requestCount + 2);
  });
  await t.test('Console readiness uses installed credentials and Legal-disabled routes make no calls', async () => {
    const token = upstream.issue('console-fixture', 'billing.connections.check');
    const probe = await api('/integration-status', { session: null, headers: { authorization: `Bearer ${token}` } });
    assert.equal(probe.status, 200);
    assert.equal(JSON.stringify(probe.body).includes(options.clientSecret), false);
    for (const route of ['/legal/prepare', '/legal/accept', '/legal/context']) assert.equal((await api(route, { method: 'POST', body: {} })).status, 404);
    assert.equal(upstream.state.requests.some((path) => path.includes('/legal')), false);
    assert.deepEqual(upstream.state.errors, []);
  });
  await t.test('optional Legal uses only resolveContext plus Console connection; existing screens keep their HTTP contract', async () => {
    await running.app.close();
    sessionA.membershipId = randomUUID();
    sessionA.roles = ['owner'];
    sessionA.permissions.push('legal.accept');
    const connection = { ...JSON.parse(options.connection), legal: {
      baseUrl: upstream.origin, audience: 'legal-api', resource: upstream.origin,
      verificationClientId: 'legal-fixture',
    } };
    running = await startAtlas({ ...options, connection: JSON.stringify(connection),
      legal: { resolveContext: authorization.resolveContext } });
    const contextToken = upstream.issue('legal-fixture', 'legal.consumer_context.read');
    const context = await api('/legal/context', { session: null, method: 'POST',
      headers: { authorization: `Bearer ${contextToken}` },
      body: { organizationId: sessionA.organizationId, subjectId: sessionA.subjectId,
        sessionId: sessionA.id, purpose: 'acceptance' } });
    assert.equal(context.status, 200);
    assert.equal(context.body.membershipId, sessionA.membershipId);
    const prepared = await api('/legal/prepare', { method: 'POST', body: { idempotencyKey: randomUUID() } });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    const accepted = await api('/legal/accept', { method: 'POST', body: {
      requestId: prepared.body.requestId, idempotencyKey: randomUUID(),
      confirmations: prepared.body.documents.map((d) => ({ documentVersionId: d.documentVersionId,
        contentHash: d.contentHash, accepted: true })),
    } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const purchase = await api('/checkout-attempts', { method: 'POST', body: {
      idempotencyKey: randomUUID(), planCode: 'atlas-pro', planPriceCode: 'atlas-monthly',
      legalAcceptanceId: accepted.body.legalAcceptanceId,
    } });
    assert.equal(purchase.status, 200, JSON.stringify(purchase.body));
    assert.equal(purchase.body.status, 'ready');
    assert.equal(upstream.state.checkoutRequests.at(-1).legalAcceptanceId, accepted.body.legalAcceptanceId);
    sessionA.permissions = sessionA.permissions.filter((p) => p !== 'legal.accept');
    const denied = await api('/legal/context', { session: null, method: 'POST',
      headers: { authorization: `Bearer ${contextToken}` },
      body: { organizationId: sessionA.organizationId, subjectId: sessionA.subjectId, purpose: 'checkout_validation' } });
    assert.equal(denied.status, 403);
    assert.deepEqual(upstream.state.errors, []);
  });

});
