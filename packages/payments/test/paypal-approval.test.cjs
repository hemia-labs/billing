const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentsClient, PaymentsError } = require('../dist');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const id = '11111111-1111-4111-8111-111111111111';
const config = {
  issuer: 'https://identity.test', tokenUrl: 'https://identity.test/oauth/token',
  clientId: 'medsync-service', clientSecret: 'SERVICE-SECRET', baseUrl: 'https://billing.test/api/v1',
  audience: 'billing-api', productCode: 'medsync', successUrl: 'https://medsync.test/return', cancelUrl: 'https://medsync.test/cancel',
};
const input = { organizationId: id, userId: id, idempotencyKey: id, operation: 'checkout', planCode: 'basic', planPriceCode: 'monthly' };
const approval = { kind: 'subscription', subscriptionId: 'I-OWNED123', clientId: 'PUBLIC-PAYPAL-APP', environment: 'sandbox' };
const receipt = () => ({
  attemptId: id, checkoutId: id, subscriptionId: id, operation: 'checkout', provider: 'paypal',
  status: 'ready', statusFresh: false, checkoutStatus: 'created', subscriptionStatus: 'pending',
  checkoutUrl: 'https://www.sandbox.paypal.com/approve', paypalApproval: { ...approval },
});
function server(result) {
  const requests = [];
  global.fetch = async (url, init = {}) => {
    if (String(url) === config.tokenUrl) return Response.json({ access_token: 'fixture-token', token_type: 'Bearer', expires_in: 600, scope: init.body.get('scope') });
    requests.push({ url: String(url), init });
    return Response.json(typeof result === 'function' ? result() : result);
  };
  return requests;
}
test('create, get and explicit retry preserve provider subscription popup metadata and the redirect fallback', async () => {
  const requests = server(receipt);
  const client = createPaymentsClient(config);
  for (const result of [await client.attempts.create(input), await client.attempts.get(id, input), await client.attempts.retry(id, input)]) {
    assert.deepEqual(result.paypalApproval, approval);
    assert.equal(result.subscriptionId, id);
    assert.equal(result.checkoutUrl, receipt().checkoutUrl);
  }
  assert.equal(requests.filter(request => request.url.includes('/payment-attempts')).length, 4);
  assert.equal(requests.filter(request => request.init.method === 'POST' && request.url.endsWith('/payment-attempts')).length, 1);
});
test('legacy receipts and unsupported flows without popup metadata still support redirect', async () => {
  const value = receipt(); delete value.paypalApproval;
  server(value);
  const result = await createPaymentsClient(config).attempts.get(id, input);
  assert.equal(result.paypalApproval, undefined);
  assert.equal(result.checkoutUrl, value.checkoutUrl);
});
test('only approved public fields survive decoding; provider credentials cannot pass through', async () => {
  const value = receipt();
  value.paypalApproval.clientSecret = 'NEVER-FORWARD';
  value.paypalApproval.accessToken = 'NEVER-FORWARD';
  value.paypalApproval.raw = { credentials: 'NEVER-FORWARD' };
  server(value);
  const result = await createPaymentsClient(config).attempts.get(id, input);
  assert.deepEqual(result.paypalApproval, approval);
  assert(!JSON.stringify(result).includes('NEVER-FORWARD'));
});
test('provider IDs and popup configuration supplied by consumer input never reach Billing', async () => {
  const requests = server(receipt);
  await createPaymentsClient(config).attempts.create({ ...input, paypalApproval: { ...approval, subscriptionId: 'I-ATTACKER' }, providerSubscriptionId: 'I-ATTACKER', providerConnectionId: id, clientId: 'ATTACKER' });
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.paypalApproval, undefined);
  assert.equal(body.providerSubscriptionId, undefined);
  assert.equal(body.providerConnectionId, undefined);
  assert.equal(body.clientId, undefined);
  assert(!JSON.stringify(body).includes('ATTACKER'));
});
test('live configuration is accepted with a matching live approval URL', async () => {
  const value = receipt(); value.paypalApproval.environment = 'live'; value.checkoutUrl = 'https://www.paypal.com/approve';
  server(value);
  assert.equal((await createPaymentsClient(config).attempts.get(id, input)).paypalApproval.environment, 'live');
});
for (const [name, mutate] of [
  ['internal UUID instead of provider subscription', v => { v.paypalApproval.subscriptionId = id; }],
  ['provider order instead of subscription', v => { v.paypalApproval.kind = 'order'; }],
  ['missing client ID', v => { delete v.paypalApproval.clientId; }],
  ['injected client ID', v => { v.paypalApproval.clientId = 'https://attacker.test'; }],
  ['unknown environment', v => { v.paypalApproval.environment = 'test'; }],
  ['mismatched environment', v => { v.paypalApproval.environment = 'live'; }],
  ['missing internal checkout', v => { delete v.checkoutId; }],
  ['missing internal subscription', v => { delete v.subscriptionId; }],
  ['missing redirect fallback', v => { delete v.checkoutUrl; }],
  ['non-PayPal provider', v => { v.provider = 'other'; }],
  ['active subscription', v => { v.subscriptionStatus = 'active'; }],
  ['completed checkout', v => { v.checkoutStatus = 'approved'; }],
  ['unprepared attempt', v => { v.status = 'processing'; }],
  ['failed attempt', v => { v.errorCode = 'BILLING_TEMPORARILY_UNAVAILABLE'; }],
  ['plan change', v => { v.operation = 'change_plan'; }],
  ['renewal revision', v => { v.operation = 'change_renewal_plan'; }],
]) test(`rejects unsafe popup metadata: ${name}`, async () => {
  const value = receipt(); mutate(value); server(value);
  await assert.rejects(createPaymentsClient(config).attempts.get(id, input), error => error instanceof PaymentsError && error.code === 'contract');
});
