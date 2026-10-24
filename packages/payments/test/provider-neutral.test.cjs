const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { createPaymentsClient } = require("../dist");
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
const id = "11111111-1111-4111-8111-111111111111";
const config = {
  issuer: "https://identity.test",
  tokenUrl: "https://identity.test/oauth/token",
  clientId: "consumer",
  clientSecret: "fixture",
  baseUrl: "https://billing.test/api/v1",
  audience: "billing",
  productCode: "product",
  successUrl: "https://product.test/success",
  cancelUrl: "https://product.test/cancel",
};
const input = {
  organizationId: id,
  userId: id,
  idempotencyKey: id,
  planCode: "pro",
  planPriceCode: "monthly",
};
const approval =
  "https://checkout.example-provider.test:443/approve?token=opaque";
function mock(receipt) {
  const calls = [];
  global.fetch = async (url, init) => {
    if (String(url) === config.tokenUrl)
      return Response.json({
        access_token: "token",
        token_type: "Bearer",
        expires_in: 600,
        scope: init.body.get("scope"),
      });
    calls.push({ url: String(url), init });
    return Response.json(receipt);
  };
  return calls;
}
function attempt(checkoutUrl = approval) {
  return {
    attemptId: id,
    operation: "checkout",
    status: "ready",
    statusFresh: false,
    provider: "example_provider",
    planCode: "pro",
    planPriceCode: "monthly",
    checkoutUrl,
  };
}
test("Billing chooses provider, core preserves optional metadata and exact idempotency without provider input", async () => {
  const receipt = {
    checkoutId: id,
    subscriptionId: id,
    status: "created",
    provider: "example_provider",
    checkoutUrl: approval,
  };
  const calls = mock(receipt);
  const client = createPaymentsClient(config);
  assert.deepEqual(await client.checkout.create(input), receipt);
  await client.checkout.create(input);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(
    Object.hasOwn(JSON.parse(calls[0].init.body), "provider"),
    false,
  );
  mock({ ...receipt, provider: undefined });
  assert.equal(
    Object.hasOwn(await client.checkout.create(input), "provider"),
    false,
  );
});
test("central create, frozen retry and explicit confirmation accept another provider without selecting it", async () => {
  const receipt = attempt();
  const calls = mock(receipt);
  const client = createPaymentsClient(config);
  assert.deepEqual(
    await client.attempts.create({
      ...input,
      operation: "checkout",
      provider: "browser_override",
    }),
    receipt,
  );
  assert.deepEqual(await client.attempts.retry(id, input), receipt);
  assert.deepEqual(await client.attempts.confirm(id, input), receipt);
  assert.equal(
    Object.hasOwn(JSON.parse(calls[0].init.body), "provider"),
    false,
  );
  assert.match(calls.at(-1).url, /\/confirm\?/);
  assert.equal(calls.at(-1).init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).idempotencyKey, id);
});
test("neutral continuation URL validates HTTPS, credentials, ports and local/IP destinations", async () => {
  const client = createPaymentsClient(config);
  for (const url of [
    "http://checkout.example/pay",
    "javascript:alert(1)",
    "/relative",
    "https://user:secret@checkout.example/pay",
    "https://checkout.example:8443/pay",
    "https://127.0.0.1/pay",
    "https://[::1]/pay",
    "https://localhost/pay",
    "https://localhost./pay",
    "https:checkout.example/pay",
    "https:///checkout.example/pay",
    " https://checkout.example/pay",
    "https://checkout.example/has space",
    "https://checkout.example\\pay",
    "https://service.localhost/pay",
  ]) {
    mock(attempt(url));
    await assert.rejects(
      client.attempts.get(id, input),
      { code: "contract" },
      url,
    );
  }
  mock(attempt());
  assert.equal((await client.attempts.get(id, input)).checkoutUrl, approval);
  mock({ ...attempt(), provider: { forged: true } });
  await assert.rejects(client.attempts.get(id, input), { code: "contract" });
});
test("a second provider's proration payment can be confirmed and canonical null suppresses stale redirect", async () => {
  const change = {
    kind: "upgrade",
    amountDueNow: "15.00",
    recurringAmount: "60.00",
    currency: "MXN",
    nextBillingAt: "2026-12-01T00:00:00Z",
    effectiveAt: "2026-11-01T00:00:00Z",
    state: "awaiting_approval",
    action: "approve_payment",
    checkoutUrl: approval,
  };
  mock({
    checkoutId: id,
    subscriptionId: id,
    checkoutStatus: "created",
    subscriptionStatus: "pending",
    provider: "example_provider",
    planChange: change,
  });
  const client = createPaymentsClient(config);
  assert.equal(
    (await client.checkout.verify(id)).planChange.checkoutUrl,
    approval,
  );
  mock({
    ...attempt(),
    operation: "change_plan",
    planChange: { ...change, checkoutUrl: null },
  });
  const pending = await client.attempts.get(id, input);
  assert.equal(pending.checkoutUrl, undefined);
  assert.equal(pending.planChange.checkoutUrl, null);
  mock({
    ...attempt(),
    operation: "change_plan",
    planChange: {
      ...change,
      state: "effective",
      action: "none",
      checkoutUrl: null,
    },
  });
  assert.equal((await client.attempts.get(id, input)).checkoutUrl, undefined);
});
