const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { createPaymentsClient, PaymentsError } = require("../dist");
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  delete global.window;
});
const config = {
  issuer: "https://identity.test",
  tokenUrl: "https://identity.test/oauth/token",
  clientId: "product-backend",
  clientSecret: "test-only-secret",
  baseUrl: "https://billing.test/api/v1",
  audience: "billing-api",
  productCode: "second-product",
  successUrl: "https://product.test/success",
  cancelUrl: "https://product.test/cancel",
};
const id = "fe1bde4d-6b71-4cd2-8b77-954d3a27de44";
const input = {
  organizationId: id,
  userId: id,
  planCode: "basic",
  planPriceCode: "monthly",
  legalAcceptanceId: id,
  idempotencyKey: "purchase-one",
};
const checkout = {
  checkoutId: id,
  subscriptionId: id,
  status: "created",
  checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=test",
};
function mock(handler) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === config.tokenUrl)
      return Response.json({
        access_token: "token.test",
        token_type: "Bearer",
        expires_in: 600,
        scope: init.body.get("scope"),
      });
    return handler(url, init);
  };
  return calls;
}
test("one product config, exact scopes, safe checkout, same key on explicit retry and no provider setup in consumer", async () => {
  const calls = mock(() => Response.json(checkout));
  const client = createPaymentsClient(config);
  assert.deepEqual(await client.checkout.create(input), checkout);
  await client.checkout.create(input);
  assert.equal(calls.length, 3);
  const token = calls[0].init.body;
  assert.equal(token.get("scope"), "billing.integration.checkout.create");
  assert.equal(token.get("audience"), "billing-api");
  const payload = JSON.parse(calls[1].init.body);
  assert.equal(payload.productCode, "second-product");
  assert.equal(Object.hasOwn(payload, "provider"), false);
  assert.equal(payload.idempotencyKey, input.idempotencyKey);
  assert.equal(calls[1].init.body, calls[2].init.body);
  assert.equal(calls[1].init.redirect, "error");
  assert.equal(calls[1].init.credentials, "omit");
});
test("read methods use isolated scopes and preserve decimal prices without provider metadata", async () => {
  const calls = mock((url) =>
    String(url).includes("/plans")
      ? Response.json([
          {
            code: "basic",
            name: "Basic",
            description: null,
            status: "active",
            productCode: "second-product",
            versions: [
              {
                version: 1,
                status: "published",
                effectiveFrom: null,
                effectiveUntil: null,
                prices: [
                  {
                    code: "monthly",
                    amount: "9007199254740993.01",
                    currency: "MXN",
                    billingInterval: "month",
                    billingIntervalCount: 1,
                    status: "active",
                    providerPrices: [{ providerPriceId: "private" }],
                  },
                ],
                entitlements: [],
              },
            ],
          },
        ])
      : Response.json({
          checkoutId: id,
          subscriptionId: id,
          checkoutStatus: "created",
          subscriptionStatus: "pending",
          provider: "paypal",
        }),
  );
  const client = createPaymentsClient(config);
  const plans = await client.catalog.listPlans();
  assert.equal(plans[0].prices[0].amount, "9007199254740993.01");
  assert(!JSON.stringify(plans).includes("private"));
  await client.checkout.status(id);
  assert.deepEqual(
    calls
      .filter((c) => c.url === config.tokenUrl)
      .map((c) => c.init.body.get("scope")),
    ["billing.integration.catalog.read", "billing.integration.checkout.read"],
  );
});
test("validates license product and never grants access from checkout status", async () => {
  const license = {
    active: false,
    productCode: "second-product",
    planCode: null,
    licenseStatus: "revoked",
    validUntil: null,
    seatsLimit: 0,
    usageLimit: null,
    subscriptionId: null,
    features: {},
  };
  const calls = mock(() => Response.json(license));
  assert.deepEqual(
    await createPaymentsClient(config).licenses.resolve(id),
    license,
  );
  assert(calls[1].url.includes("organization_id=" + id));
  assert.equal(
    calls[0].init.body.get("scope"),
    "billing.integration.licenses.read",
  );
  mock(() => Response.json({ ...license, productCode: "other" }));
  await assert.rejects(createPaymentsClient(config).licenses.resolve(id), {
    code: "contract",
  });
});
test("does not retry uncertain POST and exposes sanitized errors, not upstream body", async () => {
  const calls = mock(() => {
    throw new Error("secret URL");
  });
  await assert.rejects(createPaymentsClient(config).checkout.create(input), {
    code: "transport",
  });
  assert.equal(calls.length, 2);
  mock(() => Response.json({ message: "secret token" }, { status: 403 }));
  await assert.rejects(
    createPaymentsClient(config).checkout.create(input),
    (e) =>
      e instanceof PaymentsError &&
      e.status === 403 &&
      !JSON.stringify(e).includes("secret"),
  );
  mock(() =>
    Response.json(
      { code: "CHECKOUT_IN_PROGRESS", retryAfterSeconds: 120 },
      { status: 409 },
    ),
  );
  await assert.rejects(createPaymentsClient(config).checkout.create(input), {
    code: "CHECKOUT_IN_PROGRESS",
    retryAfterSeconds: 60,
  });
});
test("rejects browser execution, unsafe config, cross-origin returns and malformed successful replies", async () => {
  global.window = {};
  assert.throws(() => createPaymentsClient(config), { code: "configuration" });
  delete global.window;
  assert.throws(
    () => createPaymentsClient({ ...config, baseUrl: "http://public.test" }),
    { code: "configuration" },
  );
  const calls = mock(() =>
    Response.json({ ...checkout, checkoutUrl: "http://attacker.test/pay" }),
  );
  await assert.rejects(
    createPaymentsClient(config).checkout.create({
      ...input,
      successUrl: "https://attacker.test",
    }),
    { code: "configuration" },
  );
  assert.equal(calls.length, 0);
  await assert.rejects(createPaymentsClient(config).checkout.create(input), {
    code: "contract",
  });
});
test("single-flight OAuth with concurrent catalog reads and token rejection leaves no token cache", async () => {
  const calls = mock(() => Response.json([]));
  const client = createPaymentsClient(config);
  await Promise.all([client.catalog.listPlans(), client.catalog.listPlans()]);
  assert.equal(calls.filter((c) => c.url === config.tokenUrl).length, 1);
  global.fetch = async () =>
    Response.json({ message: "private" }, { status: 401 });
  await assert.rejects(createPaymentsClient(config).catalog.listPlans(), {
    code: "authentication",
  });
});

test("bounded request timeout aborts an uncertain checkout without retrying", async () => {
  let attempts = 0;
  mock(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        attempts++;
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
      }),
  );
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      createPaymentsClient({ ...config, requestTimeoutMs: 10 }).checkout.create(
        input,
      ),
      { code: "transport" },
    );
    assert.equal(attempts, 1);
  } finally {
    clearTimeout(keepAlive);
  }
});

const readOnlyConfig = {
  ...config,
  successUrl: undefined,
  cancelUrl: undefined,
};
test("read-only configuration omits checkout return URLs", async () => {
  const calls = mock(() => Response.json([]));
  await createPaymentsClient(readOnlyConfig).catalog.listPlans();
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].init.body.get("scope"),
    "billing.integration.catalog.read",
  );
});
test("checkout requires both return URLs before any OAuth or POST request", async () => {
  const calls = mock(() => Response.json(checkout));
  const client = createPaymentsClient(readOnlyConfig);
  await assert.rejects(client.checkout.create(input), {
    code: "configuration",
  });
  await assert.rejects(
    client.checkout.create({ ...input, successUrl: config.successUrl }),
    { code: "configuration" },
  );
  await assert.rejects(
    client.checkout.create({ ...input, cancelUrl: config.cancelUrl }),
    { code: "configuration" },
  );
  await assert.rejects(
    client.checkout.create({
      ...input,
      successUrl: "http://unsafe.test",
      cancelUrl: config.cancelUrl,
    }),
    { code: "configuration" },
  );
  assert.equal(calls.length, 0);
  await client.checkout.create({
    ...input,
    successUrl: config.successUrl,
    cancelUrl: config.cancelUrl,
  });
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].init.body).successUrl, config.successUrl);
  assert.equal(JSON.parse(calls[1].init.body).cancelUrl, config.cancelUrl);
});
test("a configured return origin still constrains overrides when the other URL is supplied per attempt", async () => {
  const calls = mock(() => Response.json(checkout));
  const client = createPaymentsClient({
    ...readOnlyConfig,
    successUrl: config.successUrl,
  });
  await assert.rejects(
    client.checkout.create({
      ...input,
      successUrl: "https://attacker.test/success",
      cancelUrl: config.cancelUrl,
    }),
    { code: "configuration" },
  );
  assert.equal(calls.length, 0);
  await client.checkout.create({
    ...input,
    successUrl: "https://product.test/another",
    cancelUrl: config.cancelUrl,
  });
  assert.equal(calls.length, 2);
});

test("payments-only checkout omits Legal evidence; supplied malformed evidence fails before HTTP", async () => {
  const calls = mock(() => Response.json(checkout));
  const { legalAcceptanceId, ...paymentsOnly } = input;
  const client = createPaymentsClient(config);
  await client.checkout.create(paymentsOnly);
  assert.equal(
    Object.hasOwn(JSON.parse(calls[1].init.body), "legalAcceptanceId"),
    false,
  );
  const count = calls.length;
  for (const invalid of [null, "", "invalid"])
    await assert.rejects(
      client.checkout.create({ ...input, legalAcceptanceId: invalid }),
      { code: "configuration" },
    );
  assert.equal(calls.length, count);
});

const subscriptionSummary = () => ({
  id,
  organizationId: id,
  productCode: config.productCode,
  planCode: "basic",
  planPriceCode: "monthly",
  status: "active",
  currentPeriodEnd: "2026-12-22T10:00:00.000Z",
  nextBillingTime: "2026-12-22T10:00:00.000Z",
  cancelAtPeriodEnd: false,
  cancellation: null,
  pendingPlanChange: null,
});
test("subscription management uses its exact scope, native subscription routes and sanitized product-bound summaries", async () => {
  const calls = mock(() =>
    Response.json({
      ...subscriptionSummary(),
      providerSubscriptionId: "private-provider-id",
    }),
  );
  const client = createPaymentsClient(config);
  assert.deepEqual(
    await client.subscriptions.current(id),
    subscriptionSummary(),
  );
  assert.match(calls[1].url, /api\/v1\/billing\/subscriptions\/current/);
  assert.equal(calls[0].init.body.get("scope"), "billing.subscriptions.manage");
  await client.subscriptions.cancel(id, {
    idempotencyKey: "cancel-once",
    actorUserId: id,
    reason: "Requested by owner",
  });
  assert.match(calls[2].url, /billing\/subscriptions\/[^/]+\/cancel$/);
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    idempotencyKey: "cancel-once",
    actorUserId: id,
    reason: "Requested by owner",
  });
  mock(() =>
    Response.json({
      ...subscriptionSummary(),
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
  );
  await assert.rejects(createPaymentsClient(config).subscriptions.current(id), {
    code: "contract",
  });
  mock(() => Response.json({}, { status: 404 }));
  assert.equal(
    await createPaymentsClient(config).subscriptions.current(id),
    null,
  );
  mock(() => Response.json({}, { status: 403 }));
  await assert.rejects(createPaymentsClient(config).subscriptions.current(id), {
    status: 403,
  });
});
test("plan changes bind actor and target without creating a second contract and validate canonical state", async () => {
  const changed = {
    provider: "configured_provider",
    subscription: subscriptionSummary(),
    checkoutId: id,
    newSubscriptionId: id,
    checkoutUrl: "https://checkout.configured-provider.test/revise",
    targetPlanCode: input.planCode,
    effectiveAt: "2026-12-22T10:00:00.000Z",
    state: "awaiting_approval",
  };
  const calls = mock(() => Response.json(changed));
  assert.deepEqual(
    await createPaymentsClient(config).subscriptions.changePlan(id, input),
    changed,
  );
  assert.match(calls[1].url, /subscriptions\/[^/]+\/change-plan$/);
  const payload = JSON.parse(calls[1].init.body);
  assert.equal(payload.actorUserId, input.userId);
  assert.equal(payload.targetPlanPriceCode, input.planPriceCode);
  assert.equal(payload.legalAcceptanceId, input.legalAcceptanceId);
  assert.equal(payload.organizationId, undefined);
  mock(() =>
    Response.json({ ...changed, checkoutUrl: "http://attacker.test/pay" }),
  );
  await assert.rejects(
    createPaymentsClient(config).subscriptions.changePlan(id, input),
    { code: "contract" },
  );
  mock(() =>
    Response.json({
      checkoutId: id,
      subscriptionId: id,
      checkoutStatus: "approved",
      subscriptionStatus: "active",
      provider: "paypal",
      planChange: { state: "scheduled", effectiveAt: changed.effectiveAt },
    }),
  );
  assert.deepEqual(
    (await createPaymentsClient(config).checkout.status(id)).planChange,
    { state: "scheduled", effectiveAt: changed.effectiveAt },
  );
});

test("a canonically accepted revision recovers a lost approval URL using only the exact validated success return", async () => {
  const response = {
    subscription: subscriptionSummary(),
    checkoutId: id,
    newSubscriptionId: id,
    checkoutUrl: config.successUrl,
    targetPlanCode: input.planCode,
    effectiveAt: "2026-12-22T10:00:00.000Z",
    state: "scheduled",
  };
  mock(() => Response.json(response));
  assert.equal(
    (await createPaymentsClient(config).subscriptions.changePlan(id, input))
      .checkoutUrl,
    config.successUrl,
  );
  for (const invalid of [
    { ...response, state: "awaiting_approval" },
    { ...response, checkoutUrl: config.successUrl + "?unexpected=1" },
    { ...response, checkoutUrl: "http://attacker.test/pay" },
  ]) {
    mock(() => Response.json(invalid));
    await assert.rejects(
      createPaymentsClient(config).subscriptions.changePlan(id, input),
      { code: "contract" },
    );
  }
});

test("quotes retain decimal amounts and confirmation is an explicit POST with validated provider continuation", async () => {
  const quote = {
    kind: "upgrade",
    amountDueNow: "150.01",
    currency: "MXN",
    recurringAmount: "600.00",
    effectiveAt: "2026-10-23T12:00:00Z",
    nextBillingAt: "2026-11-01T00:00:00Z",
  };
  const change = {
    ...quote,
    state: "awaiting_approval",
    action: "approve_payment",
    checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order",
  };
  const calls = mock((url) =>
    Response.json(
      String(url).includes("plan-change-quote")
        ? quote
        : {
            checkoutId: id,
            subscriptionId: id,
            checkoutStatus: "created",
            subscriptionStatus: "pending",
            provider: "paypal",
            planChange: change,
          },
    ),
  );
  const client = createPaymentsClient(config);
  assert.deepEqual(
    await client.subscriptions.planChangeQuote(id, "pro", "monthly"),
    quote,
  );
  assert.equal(calls[1].init.method, "GET");
  assert.match(
    calls[1].url,
    /target_plan_code=pro&target_plan_price_code=monthly/,
  );
  assert.deepEqual((await client.checkout.verify(id)).planChange, change);
  const verify = calls.find((c) => c.url.endsWith("/verify"));
  assert.equal(verify.init.method, "POST");
  mock(() =>
    Response.json({
      checkoutId: id,
      subscriptionId: id,
      checkoutStatus: "created",
      subscriptionStatus: "pending",
      provider: "paypal",
      planChange: {
        ...change,
        checkoutUrl: "https://credentials@checkout.example/approve",
      },
    }),
  );
  await assert.rejects(createPaymentsClient(config).checkout.verify(id), {
    code: "contract",
  });
  mock(() => Response.json({ ...quote, amountDueNow: 150 }));
  await assert.rejects(
    createPaymentsClient(config).subscriptions.planChangeQuote(
      id,
      "pro",
      "monthly",
    ),
    { code: "contract" },
  );
});

test("subscription summaries preserve validated pending upgrade amounts and nullable approval action", async () => {
  const pending = {
    attemptId: id,
    state: "awaiting_approval",
    targetPlanCode: "pro",
    targetPlanPriceCode: "monthly",
    effectiveAt: "2026-10-23T12:00:00Z",
    checkoutId: id,
    newSubscriptionId: id,
    kind: "upgrade",
    amountDueNow: "150.00",
    currency: "MXN",
    recurringAmount: "600.00",
    nextBillingAt: "2026-11-01T00:00:00Z",
    action: "approve_subscription",
    checkoutUrl: null,
  };
  mock(() =>
    Response.json({ ...subscriptionSummary(), pendingPlanChange: pending }),
  );
  assert.deepEqual(
    (await createPaymentsClient(config).subscriptions.current(id))
      .pendingPlanChange,
    pending,
  );
  mock(() =>
    Response.json({
      ...subscriptionSummary(),
      pendingPlanChange: {
        ...pending,
        checkoutUrl: "http://attacker.test/pay",
      },
    }),
  );
  await assert.rejects(createPaymentsClient(config).subscriptions.current(id), {
    code: "contract",
  });
  mock(() =>
    Response.json({
      ...subscriptionSummary(),
      pendingPlanChange: { ...pending, attemptId: "not-a-uuid" },
    }),
  );
  await assert.rejects(createPaymentsClient(config).subscriptions.current(id), {
    code: "contract",
  });
});

test("read-only status preserves a pending proration without creating or requiring its payment URL", async () => {
  const change = {
    kind: "upgrade",
    amountDueNow: "150.00",
    currency: "MXN",
    recurringAmount: "600.00",
    effectiveAt: "2026-10-23T12:00:00Z",
    nextBillingAt: "2026-11-01T00:00:00Z",
    state: "awaiting_approval",
    action: "approve_payment",
    checkoutUrl: null,
  };
  const calls = mock(() =>
    Response.json({
      checkoutId: id,
      subscriptionId: id,
      checkoutStatus: "created",
      subscriptionStatus: "pending",
      provider: "paypal",
      planChange: change,
      checkoutUrl: null,
    }),
  );
  const result = await createPaymentsClient(config).checkout.status(id);
  assert.deepEqual(result.planChange, change);
  assert.equal(result.checkoutUrl, null);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, "GET");
  mock(() =>
    Response.json({
      checkoutId: id,
      subscriptionId: id,
      checkoutStatus: "created",
      subscriptionStatus: "pending",
      provider: "paypal",
      planChange: { ...change, action: "approve_subscription" },
    }),
  );
  await assert.rejects(createPaymentsClient(config).checkout.status(id), {
    code: "contract",
  });
});


test("pending subscriptions preserve a durable checkout attempt and reject malformed recovery identifiers", async () => {
  const summary = { ...subscriptionSummary(), status: "pending", pendingCheckoutAttemptId: id };
  mock(() => Response.json(summary));
  const client = createPaymentsClient(config);
  assert.equal((await client.subscriptions.current(id)).pendingCheckoutAttemptId, id);
  summary.pendingCheckoutAttemptId = "not-an-attempt";
  await assert.rejects(client.subscriptions.current(id), (error) => error instanceof PaymentsError && error.code === "contract");
});

test("local abandonment is preserved without pretending PayPal was cancelled", async () => {
  const calls = mock(() => Response.json({ cancelled: true, abandoned: true }));
  const result = await createPaymentsClient(config).attempts.cancel(id, { organizationId: id, userId: id });
  assert.deepEqual(result, { cancelled: true, abandoned: true });
  const transport = calls.find(c => c.url.includes("payment-attempts/"));
  assert.equal(transport.init.method, "POST");
  assert.match(transport.url, /\/cancel\?/);
});
for (const invalid of [
  { cancelled: false, abandoned: true },
  { cancelled: true, abandoned: "true" },
  { cancelled: true, abandoned: true, approvalUrl: "https://www.paypal.com/approve" },
]) {
  test(`rejects inconsistent abandonment receipt ${JSON.stringify(invalid)}`, async () => {
    mock(() => Response.json(invalid));
    await assert.rejects(createPaymentsClient(config).attempts.cancel(id, { organizationId: id, userId: id }),
      error => error instanceof PaymentsError && error.code === "contract");
  });
}

test("an abandoned receipt never exposes an old approval URL or accepts an active contract", async () => {
  const value = { attemptId: id, operation: "checkout", status: "ready", statusFresh: true,
    checkoutStatus: "cancelled", subscriptionStatus: "cancelled", abandoned: true,
    checkoutUrl: "https://www.sandbox.paypal.com/approve?token=old" };
  mock(() => Response.json(value));
  const client = createPaymentsClient(config);
  const receipt = await client.attempts.get(id, { organizationId: id, userId: id });
  assert.equal(receipt.abandoned, true);
  assert.equal(receipt.checkoutUrl, undefined);
  for (const changed of [{ abandoned: "true" }, { subscriptionStatus: "active" }, { checkoutStatus: "approved" }]) {
    mock(() => Response.json({ ...value, ...changed }));
    await assert.rejects(createPaymentsClient(config).attempts.get(id, { organizationId: id, userId: id }),
      error => error instanceof PaymentsError && error.code === "contract");
  }
});

for (const cancelling of [false, true]) {
  test(`scheduled cancellation exposes only the restoration approval action (${cancelling})`, async () => {
    const restoreUrl = "https://www.sandbox.paypal.com/restore/current-plan";
    mock(() => Response.json({ attemptId: id, operation: "change_plan", status: "ready", statusFresh: true,
      checkoutStatus: "pending", subscriptionStatus: "pending", checkoutUrl: "https://www.sandbox.paypal.com/approve/old",
      planChange: { state: "scheduled", cancellationRequested: cancelling, kind: "downgrade", amountDueNow: "0.00",
        currency: "MXN", recurringAmount: "499.00", effectiveAt: "2026-11-26T10:00:00Z", nextBillingAt: "2026-11-26T10:00:00Z",
        action: cancelling ? "approve_subscription" : "none", checkoutUrl: cancelling ? restoreUrl : null },
    }));
    const receipt = await createPaymentsClient(config).attempts.get(id, { organizationId: id, userId: id });
    assert.equal(receipt.checkoutUrl, cancelling ? restoreUrl : undefined);
    assert.equal(receipt.planChange.cancellationRequested, cancelling);
  });
}

for (const cancelling of [false, true]) {
  test(`restoration awaiting its URL stays recoverable without exposing the original approval (${cancelling})`, async () => {
    mock(() => Response.json({ attemptId: id, operation: "change_plan", status: "ready", statusFresh: true,
      checkoutStatus: "pending", subscriptionStatus: "pending", checkoutUrl: "https://www.sandbox.paypal.com/approve/old",
      planChange: { state: "scheduled", cancellationRequested: cancelling, kind: "downgrade", amountDueNow: "0.00",
        currency: "MXN", recurringAmount: "499.00", effectiveAt: "2026-11-26T10:00:00Z", nextBillingAt: "2026-11-26T10:00:00Z",
        action: "approve_subscription", checkoutUrl: null },
    }));
    const request = createPaymentsClient(config).attempts.get(id, { organizationId: id, userId: id });
    if (!cancelling) return assert.rejects(request, error => error.code === "contract");
    const receipt = await request;
    assert.equal(receipt.checkoutUrl, undefined);
    assert.equal(receipt.planChange.checkoutUrl, null);
    assert.equal(receipt.planChange.cancellationRequested, true);
  });
}

const renewalSourceId = "11111111-1111-4111-8111-111111111111";
const renewal = { state: "awaiting_approval", sourceSubscriptionId: renewalSourceId,
  effectiveAt: "2026-11-26T10:00:00.000Z", amountDueNow: "0.00", recurringAmount: "999.00", currency: "MXN" };
const renewalReceipt = { attemptId: id, operation: "resume_renewal", status: "ready", statusFresh: true,
  subscriptionId: id, planCode: "business", planPriceCode: "monthly", checkoutStatus: "pending", subscriptionStatus: "pending",
  checkoutUrl: "https://www.sandbox.paypal.com/approve/renewal", renewalResume: renewal };
test("renewal resumption keeps the known source, zero due today and future quote; retry reauthorizes management with the same key", async () => {
  const calls = mock(() => Response.json(renewalReceipt));
  const client = createPaymentsClient(config);
  const request = { organizationId: id, userId: id, operation: "resume_renewal", idempotencyKey: id,
    expectedSubscriptionId: renewalSourceId, planCode: "business", planPriceCode: "monthly" };
  const receipt = await client.attempts.create(request);
  assert.deepEqual(receipt.renewalResume, renewal);
  await client.attempts.retry(id, { organizationId: id, userId: id });
  const tokenCalls = calls.filter(c => c.url === config.tokenUrl);
  assert.ok(tokenCalls.every(c => c.init.body.get("scope").includes("billing.subscriptions.manage") || c.init.body.get("scope").includes("billing.integration.checkout.read")));
  const mutations = calls.filter(c => c.init.method === "POST" && c.url !== config.tokenUrl);
  assert.equal(mutations.length, 2);
  const payload = JSON.parse(mutations[0].init.body);
  assert.equal(payload.idempotencyKey, id);
  assert.equal(payload.expectedSubscriptionId, renewalSourceId);
  assert.equal(Object.hasOwn(payload, "legalAcceptanceId"), false);
  assert.match(mutations[1].url, new RegExp(`${id}/retry`));
});
for (const state of ["scheduled", "effective", "failed"]) {
  test(`renewal ${state} never exposes an old provider approval URL`, async () => {
    mock(() => Response.json({ ...renewalReceipt, renewalResume: { ...renewal, state } }));
    const receipt = await createPaymentsClient(config).attempts.get(id, { organizationId: id, userId: id });
    assert.equal(receipt.checkoutUrl, undefined);
    assert.equal(receipt.renewalResume.state, state);
  });
}
for (const invalid of [{ amountDueNow: "999.00" }, { amountDueNow: "0" }, { recurringAmount: "NaN" },
  { recurringAmount: "0.00" }, { effectiveAt: null }, { currency: "mxn" }, { sourceSubscriptionId: id }]) {
  test(`renewal refuses an unsafe quote ${JSON.stringify(invalid)}`, async () => {
    mock(() => Response.json({ ...renewalReceipt, renewalResume: { ...renewal, ...invalid } }));
    await assert.rejects(createPaymentsClient(config).attempts.get(id, { organizationId: id, userId: id }), { code: "contract" });
  });
}
test("renewal creation refuses a receipt for another source or plan", async () => {
  const request = { organizationId: id, userId: id, operation: "resume_renewal", idempotencyKey: id,
    expectedSubscriptionId: renewalSourceId, planCode: "business", planPriceCode: "monthly" };
  for (const altered of [ { renewalResume: { ...renewal, sourceSubscriptionId: "22222222-2222-4222-8222-222222222222" } }, { planCode: "other" }, { planPriceCode: "yearly" }, { renewalResume: undefined }, { operation: "checkout", renewalResume: undefined } ]) {
    mock(() => Response.json({ ...renewalReceipt, ...altered }));
    await assert.rejects(createPaymentsClient(config).attempts.create(request), { code: "contract" });
  }
});
test("pending renewal summaries bind source and new subscription and hide terminal approval links", async () => {
  const summary = { ...subscriptionSummary(), id: renewalSourceId, status: "cancelled", cancelAtPeriodEnd: true,
    pendingRenewal: { ...renewal, state: "scheduled", attemptId: id, subscriptionId: id, checkoutUrl: renewalReceipt.checkoutUrl } };
  mock(() => Response.json(summary));
  const parsed = await createPaymentsClient(config).subscriptions.current(id);
  assert.equal(parsed.pendingRenewal.checkoutUrl, null);
  for (const invalid of [{ sourceSubscriptionId: id }, { subscriptionId: renewalSourceId }, { attemptId: "bad" }, { amountDueNow: "1.00" }]) {
    mock(() => Response.json({ ...summary, pendingRenewal: { ...summary.pendingRenewal, ...invalid } }));
    await assert.rejects(createPaymentsClient(config).subscriptions.current(id), { code: "contract" });
  }
});

const renewalRevisionId = "22222222-2222-4222-8222-222222222222";
const renewalRevisionCheckoutId = "33333333-3333-4333-8333-333333333333";
const renewalRevision = { ...renewal, renewalSubscriptionId: id, targetPlanCode: "professional", targetPlanPriceCode: "monthly",
  recurringAmount: "499.00", cancellationRequested: false, action: "approve_subscription", checkoutUrl: "https://www.sandbox.paypal.com/revise/future" };
const renewalRevisionReceipt = { ...renewalReceipt, attemptId: renewalRevisionId, operation: "change_renewal_plan",
  checkoutId: renewalRevisionCheckoutId, planCode: "professional", checkoutUrl: "https://www.sandbox.paypal.com/old",
  renewalResume: undefined, renewalPlanChange: renewalRevision };
const renewalRevisionRequest = { organizationId: id, userId: id, idempotencyKey: renewalRevisionId,
  operation: "change_renewal_plan", expectedSubscriptionId: renewalSourceId, expectedRenewalSubscriptionId: id,
  planCode: "professional", planPriceCode: "monthly" };
test("changing a future renewal binds source and existing candidate without altering its first date or charging today", async () => {
  const calls = mock(() => Response.json(renewalRevisionReceipt));
  const receipt = await createPaymentsClient(config).attempts.create(renewalRevisionRequest);
  assert.equal(receipt.checkoutUrl, renewalRevision.checkoutUrl);
  assert.deepEqual(receipt.renewalPlanChange, renewalRevision);
  const payload = JSON.parse(calls.find(c => c.url.includes("/payment-attempts") && c.init.method === "POST").init.body);
  assert.equal(payload.operation, "change_renewal_plan");
  assert.equal(payload.expectedSubscriptionId, renewalSourceId);
  assert.equal(payload.expectedRenewalSubscriptionId, id);
  assert.equal(Object.hasOwn(payload, "effectiveAt"), false);
  assert.equal(Object.hasOwn(payload, "amountDueNow"), false);
});
for (const variant of [
  { state: "scheduled", cancellationRequested: false }, { state: "scheduled", cancellationRequested: true },
  { state: "failed", cancellationRequested: true }, { state: "awaiting_approval", checkoutUrl: null },
]) {
  test(`future renewal revision keeps only its current restoration or approval URL ${JSON.stringify(variant)}`, async () => {
    mock(() => Response.json({ ...renewalRevisionReceipt, renewalPlanChange: { ...renewalRevision, ...variant } }));
    const receipt = await createPaymentsClient(config).attempts.get(renewalRevisionId, { organizationId: id, userId: id });
    const active = variant.state === "scheduled" && variant.cancellationRequested;
    assert.equal(receipt.checkoutUrl, active ? renewalRevision.checkoutUrl : undefined);
    assert.notEqual(receipt.checkoutUrl, renewalRevisionReceipt.checkoutUrl);
  });
}
for (const invalid of [{ amountDueNow: "1.00" }, { renewalSubscriptionId: renewalSourceId }, { targetPlanCode: "other" },
  { targetPlanPriceCode: "yearly" }, { cancellationRequested: "true" }, { action: "approve_payment" }, { checkoutUrl: "http://unsafe.test/approve" }]) {
  test(`future renewal revision refuses unsafe binding ${JSON.stringify(invalid)}`, async () => {
    mock(() => Response.json({ ...renewalRevisionReceipt, renewalPlanChange: { ...renewalRevision, ...invalid } }));
    await assert.rejects(createPaymentsClient(config).attempts.get(renewalRevisionId, { organizationId: id, userId: id }), { code: "contract" });
  });
}
test("future revision creation rejects wrong operations, source, candidate and missing revision receipts", async () => {
  for (const changed of [{ operation: "checkout", renewalPlanChange: undefined }, { renewalPlanChange: undefined },
    { subscriptionId: renewalSourceId }, { checkoutId: undefined }, { renewalPlanChange: { ...renewalRevision, sourceSubscriptionId: "44444444-4444-4444-8444-444444444444" } }]) {
    mock(() => Response.json({ ...renewalRevisionReceipt, ...changed }));
    await assert.rejects(createPaymentsClient(config).attempts.create(renewalRevisionRequest), { code: "contract" });
  }
  const calls = mock(() => { throw new Error("Invalid input must not reach transport"); });
  await assert.rejects(createPaymentsClient(config).attempts.create({ ...renewalRevisionRequest, expectedRenewalSubscriptionId: undefined }), { code: "configuration" });
  await assert.rejects(createPaymentsClient(config).attempts.create({ ...renewalRevisionRequest, operation: "resume_renewal" }), { code: "configuration" });
  assert.equal(calls.length, 0);
});
test("future authorized plan names and revision recovery survive subscription parsing without replacing current paid plan", async () => {
  const summary = { ...subscriptionSummary(), id: renewalSourceId, planCode: "business", status: "cancelled", cancelAtPeriodEnd: true,
    pendingRenewal: { ...renewal, recurringAmount: "499.00", planCode: "professional", planPriceCode: "monthly", state: "scheduled", attemptId: id, subscriptionId: id },
    pendingRenewalPlanChange: { ...renewalRevision, attemptId: renewalRevisionId, checkoutId: renewalRevisionCheckoutId } };
  mock(() => Response.json(summary));
  const receipt = await createPaymentsClient(config).subscriptions.current(id);
  assert.equal(receipt.planCode, "business");
  assert.equal(receipt.pendingRenewal.planCode, "professional");
  assert.equal(receipt.pendingRenewal.recurringAmount, "499.00");
  assert.equal(receipt.pendingRenewalPlanChange.checkoutUrl, renewalRevision.checkoutUrl);
  mock(() => Response.json({ ...renewalReceipt, renewalResume: { ...renewal, planCode: "professional", planPriceCode: "monthly", recurringAmount: "499.00" } }));
  const resumed = await createPaymentsClient(config).attempts.get(id, { organizationId: id, userId: id });
  assert.equal(resumed.planCode, "business");
  assert.equal(resumed.renewalResume.planCode, "professional");
});

test("a later canonical cancellation restoration replaces a terminal receipt without reviving its target approval", async () => {
  let value = { ...renewalRevisionReceipt, status: "rejected", errorCode: "PAYMENT_ATTEMPT_CANCELLED",
    checkoutUrl: undefined, renewalPlanChange: { ...renewalRevision, state: "failed", cancellationRequested: true, action: "none", checkoutUrl: null } };
  mock(() => Response.json(value));
  const client = createPaymentsClient(config), buyer = { organizationId: id, userId: id };
  assert.equal((await client.attempts.get(renewalRevisionId, buyer)).checkoutUrl, undefined);
  const restoreUrl = "https://www.sandbox.paypal.com/restore/original-after-late-approval";
  value = { ...value, status: "ready", errorCode: undefined, checkoutUrl: "https://www.sandbox.paypal.com/old-target-approval",
    renewalPlanChange: { ...renewalRevision, state: "awaiting_approval", cancellationRequested: true, checkoutUrl: restoreUrl } };
  const latest = await client.attempts.get(renewalRevisionId, buyer);
  assert.equal(latest.status, "ready");
  assert.equal(latest.checkoutUrl, restoreUrl);
  assert.equal(latest.renewalPlanChange.cancellationRequested, true);
  assert.equal(latest.renewalPlanChange.amountDueNow, "0.00");
});
