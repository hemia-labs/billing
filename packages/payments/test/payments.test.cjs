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
  assert.equal(payload.provider, "paypal");
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
    Response.json({ ...checkout, checkoutUrl: "https://attacker.test/pay" }),
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
  assert.equal(Object.hasOwn(JSON.parse(calls[1].init.body), 'legalAcceptanceId'), false);
  const count = calls.length;
  for (const invalid of [null, '', 'invalid'])
    await assert.rejects(client.checkout.create({ ...input, legalAcceptanceId: invalid }), { code: 'configuration' });
  assert.equal(calls.length, count);
});
