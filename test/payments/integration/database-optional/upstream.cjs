// Protocol fixture only. Billing's actual durable service is tested separately against PostgreSQL.
const { createServer } = require('node:http');
const { randomUUID, generateKeyPairSync, sign } = require('node:crypto');
async function upstreamFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'optional-fixture', alg: 'RS256', use: 'sig' };
  const tokens = new Map(), attempts = new Map();
  const state = { revision: 9007199254740993n, lost: false, creates: 0, confirms: 0, revoked: false };
  const organizationId = randomUUID(), userId = randomUUID(), subscriptionId = randomUUID();
  let origin;
  const issue = (clientId = 'billing-fixture', scope = 'billing.webhooks.deliver', audience = 'fixture-api') => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: origin, sub: clientId, client_id: clientId, aud: audience, grant_type: 'client_credentials', scope, iat: now, exp: now + 300 };
    const value = [{ alg: 'RS256', typ: 'at+jwt', kid: jwk.kid }, claims].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
    const token = value + '.' + sign('RSA-SHA256', Buffer.from(value), privateKey).toString('base64url');
    tokens.set(token, claims); return token;
  };
  function snapshot(org = organizationId) {
    return {
      organizationId: org, productCode: 'fixture', revision: String(state.revision), confirmedAt: new Date().toISOString(),
      license: { active: true, productCode: 'fixture', subscriptionId, planCode: 'pro', licenseStatus: 'active', validUntil: new Date(Date.now() + 86400000).toISOString(), seatsLimit: 3, usageLimit: null, features: { reports: true }, entitlements: { maxUsers: 3 }, billing: { nextBillingTime: null } },
      subscription: { id: subscriptionId, organizationId: org, productCode: 'fixture', planCode: 'pro', planPriceCode: 'monthly', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(), nextBillingTime: null, cancelAtPeriodEnd: false, cancellation: null, pendingPlanChange: null },
    };
  }
  const server = createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, origin); let raw = '';
      for await (const chunk of req) raw += chunk;
      if (url.pathname === '/.well-known/jwks.json') return send(200, { keys: [jwk] });
      if (url.pathname === '/oauth/token' || url.pathname === '/oauth/introspect') {
        const form = new URLSearchParams(raw);
        if (form.get('client_id') !== 'fixture-backend' || form.get('client_secret') !== 'fixture-only') return send(401, {});
        if (url.pathname.endsWith('/introspect')) {
          const claims = tokens.get(form.get('token'));
          return send(200, claims && !state.revoked ? { active: true, aud: claims.aud, client_id: claims.client_id, scope: claims.scope, exp: claims.exp } : { active: false });
        }
        return send(200, { access_token: issue('fixture-backend', form.get('scope'), form.get('audience')), token_type: 'Bearer', expires_in: 300, scope: form.get('scope') });
      }
      const claims = tokens.get(req.headers.authorization?.replace(/^Bearer /, ''));
      if (!claims || claims.client_id !== 'fixture-backend' || claims.aud !== 'billing-api') return send(401, {});
      if (url.pathname.endsWith('/snapshots')) return send(200, snapshot(url.searchParams.get('organization_id')));
      if (url.pathname.endsWith('/licenses/resolve')) return send(200, snapshot().license);
      if (url.pathname.endsWith('/catalog/products/fixture/plans')) return send(200, []);
      if (url.pathname.endsWith('/payment-attempts') && req.method === 'POST') {
        const input = JSON.parse(raw), previous = attempts.get(input.idempotencyKey);
        if (previous && JSON.stringify(previous.input) !== JSON.stringify(input)) return send(409, {});
        if (!previous) {
          state.creates++;
          attempts.set(input.idempotencyKey, { input, receipt: { attemptId: input.idempotencyKey, operation: input.operation, status: 'ready', statusFresh: true, checkoutId: randomUUID(), subscriptionId, planCode: input.planCode, planPriceCode: input.planPriceCode, checkoutUrl: 'https://www.sandbox.paypal.com/approve-fixture', checkoutStatus: 'created', subscriptionStatus: 'pending' } });
        }
        if (state.lost) { state.lost = false; return req.socket.destroy(); }
        return send(200, attempts.get(input.idempotencyKey).receipt);
      }
      const route = /\/payment-attempts\/([^/]+)(?:\/(retry|confirm))?$/.exec(url.pathname);
      if (route) {
        const saved = attempts.get(route[1]);
        if (!saved || saved.input.organizationId !== url.searchParams.get('organizationId') || saved.input.userId !== url.searchParams.get('userId') || saved.input.productCode !== url.searchParams.get('productCode')) return send(404, {});
        if (route[2] === 'confirm') {
          if (saved.input.operation !== 'change_plan') return send(409, {});
          state.confirms++;
        }
        return send(200, saved.receipt);
      }
      return send(404, {});
    } catch (error) { return send(500, { error: error.message }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const connection = { issuer: origin, tokenUrl: origin + '/oauth/token', clientId: 'fixture-backend', baseUrl: origin + '/api/v1', audience: 'billing-api', resource: origin, productCode: 'fixture', successUrl: 'https://product.example.test/success', cancelUrl: 'https://product.example.test/cancel', allowHttpLoopback: true, receiver: { audience: 'fixture-api', billingClientId: 'billing-fixture', consoleClientId: 'console-fixture' } };
  return { connection, state, organizationId, userId, subscriptionId, snapshot, issue, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
module.exports = { upstreamFixture };
