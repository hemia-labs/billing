// Explicit upstream test doubles: OAuth/Identity and Billing, not commercial services.
const { createServer } = require('node:http');
const { generateKeyPairSync, sign, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

async function upstreamFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'atlas-fixture', alg: 'RS256', use: 'sig' };
  const tokens = new Map(), evidence = new Map(), orders = new Map(), prepared = new Map();
  const state = { requests: [], checkoutRequests: [], errors: [], revoked: false, loseNextCheckout: true };
  let origin;
  const issue = (clientId, scope, audience = 'atlas-api', overrides = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: origin, sub: clientId, client_id: clientId, aud: audience, grant_type: 'client_credentials', scope, iat: now, nbf: now, exp: now + 300, jti: randomUUID(), ...overrides };
    const encoded = [ { alg: 'RS256', typ: 'at+jwt', kid: jwk.kid }, claims ].map((value) => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    const token = encoded + '.' + sign('RSA-SHA256', Buffer.from(encoded), privateKey).toString('base64url');
    tokens.set(token, claims);
    return token;
  };
  const server = createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    try {
      const url = new URL(request.url, origin);
      state.requests.push(url.pathname);
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      if (url.pathname === '/.well-known/jwks.json') return send(200, { keys: [jwk] });
      if (url.pathname === '/oauth/token' || url.pathname === '/oauth/introspect') {
        const form = new URLSearchParams(raw);
        assert.equal(form.get('client_id'), 'atlas-backend');
        assert.equal(form.get('client_secret'), 'fixture-only-atlas-secret');
        if (url.pathname.endsWith('/introspect')) {
          const claims = tokens.get(form.get('token'));
          return send(200, claims && !state.revoked ? { active: true, aud: claims.aud, client_id: claims.client_id, scope: claims.scope, exp: claims.exp } : { active: false });
        }
        assert.equal(form.get('grant_type'), 'client_credentials');
        assert.ok(['billing-api', 'legal-api'].includes(form.get('audience')));
        assert.equal(form.get('resource'), origin);
        const token = issue('atlas-backend', form.get('scope'), form.get('audience'));
        return send(200, { access_token: token, token_type: 'Bearer', expires_in: 300, scope: form.get('scope') });
      }
      const claims = tokens.get(request.headers.authorization?.replace(/^Bearer /, ''));
      if (url.pathname.startsWith('/v1/legal/integrations/')) {
        if (!claims || claims.client_id !== 'atlas-backend' || claims.aud !== 'legal-api') return send(401, {});
        const body = JSON.parse(raw);
        if (url.pathname.endsWith('/acceptance-requests')) {
          assert.equal(claims.scope, 'legal.integration.acceptances.prepare');
          const value = { requestId: randomUUID(), identitySourceId: randomUUID(), productCode: 'atlas',
            expiresAt: new Date(Date.now() + 300000).toISOString(), documents: [{ documentId: randomUUID(),
              documentVersionId: randomUUID(), contentHash: 'a'.repeat(64), title: 'Atlas Terms', version: '1', kind: 'terms',
              artifacts: { html: { url: origin + '/documents/terms.html' } } }] };
          prepared.set(value.requestId, { value, body });
          return send(201, value);
        }
        assert.equal(claims.scope, 'legal.integration.acceptances.create');
        const saved = prepared.get(body.requestId);
        if (!saved || saved.body.subjectId !== body.subjectId || saved.body.organizationId !== body.organizationId ||
          !body.confirmations?.every((c) => c.accepted === true && saved.value.documents.some((d) =>
            d.documentVersionId === c.documentVersionId && d.contentHash === c.contentHash))) return send(403, {});
        const legalAcceptanceId = randomUUID();
        evidence.set(legalAcceptanceId, { subjectId: body.subjectId, organizationId: body.organizationId, productCode: 'atlas' });
        return send(201, { requestId: body.requestId, legalAcceptanceId, identitySourceId: saved.value.identitySourceId,
          productCode: 'atlas', accepted: true });
      }
      if (!claims || claims.client_id !== 'atlas-backend' || claims.aud !== 'billing-api') return send(401, { code: 'unauthorized' });
      if (url.pathname === '/api/v1/billing/integrations/v1/catalog/products/atlas/plans') {
        assert.equal(claims.scope, 'billing.integration.catalog.read');
        return send(200, [{ code: 'atlas-pro', name: 'Atlas Pro', description: null, productCode: 'atlas', status: 'active', versions: [{ version: 1, status: 'published', effectiveFrom: null, effectiveUntil: null, prices: [{ code: 'atlas-monthly', amount: '149.90', currency: 'MXN', billingInterval: 'month', billingIntervalCount: 1, status: 'active' }], entitlements: [] }] }]);
      }
      if (url.pathname === '/api/v1/billing/integrations/v1/checkout/sessions' && request.method === 'POST') {
        assert.equal(claims.scope, 'billing.integration.checkout.create');
        const body = JSON.parse(raw);
        assert.equal(body.productCode, 'atlas');
        const consent = evidence.get(body.legalAcceptanceId);
        // Hemia Legal is optional; supplied evidence must still be valid.
        if (body.legalAcceptanceId !== undefined && (!consent || consent.organizationId !== body.organizationId || consent.subjectId !== body.userId || consent.productCode !== body.productCode)) return send(422, { code: 'LEGAL_ACCEPTANCE_INVALID' });
        state.checkoutRequests.push(body);
        const key = JSON.stringify([body.organizationId, body.productCode, body.idempotencyKey]);
        const previous = orders.get(key);
        if (previous && JSON.stringify(previous.input) !== JSON.stringify(body)) return send(409, { code: 'IDEMPOTENCY_CONFLICT' });
        const order = previous ?? { input: body, result: { checkoutId: randomUUID(), subscriptionId: randomUUID(), checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ATLAS-FIXTURE', status: 'pending' } };
        orders.set(key, order);
        if (previous && state.onDuplicateCheckout) state.onDuplicateCheckout();
        if (!previous && state.beforeCheckoutResponse) await state.beforeCheckoutResponse(order);
        if (state.loseNextCheckout) { state.loseNextCheckout = false; response.destroy(); return; }
        return send(201, order.result);
      }
      const status = /\/checkout\/sessions\/([^/]+)\/status$/.exec(url.pathname);
      if (status) {
        assert.equal(claims.scope, 'billing.integration.checkout.read');
        const order = [...orders.values()].find((row) => row.result.checkoutId === status[1]);
        return order ? send(200, { checkoutId: order.result.checkoutId, subscriptionId: order.result.subscriptionId, checkoutStatus: order.remoteStatus?.checkoutStatus ?? 'pending', subscriptionStatus: order.remoteStatus?.subscriptionStatus ?? 'pending', provider: 'paypal' }) : send(404, {});
      }
      state.errors.push(`Unexpected upstream route ${url.pathname}`);
      return send(404, {});
    } catch (error) {
      state.errors.push(error.message);
      send(500, { code: 'FIXTURE_CONTRACT_FAILURE' });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, state, issue, orders,
    confirmAcceptance(context) { const id = randomUUID(); evidence.set(id, { ...context, productCode: 'atlas' }); return id; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
module.exports = { upstreamFixture };
