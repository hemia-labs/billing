const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, generateKeyPairSync, sign } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const {
  createPaymentsClient,
  createPaymentsReceiver,
  createPaymentsLegalClient,
  snapshotAccess,
} = require("../dist");
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
const org = randomUUID(),
  user = randomUUID(),
  sub = randomUUID();
const config = {
  issuer: "https://identity.test",
  tokenUrl: "https://identity.test/oauth/token",
  clientId: "consumer",
  clientSecret: "fixture-only",
  baseUrl: "https://billing.test/api/v1",
  audience: "billing-api",
  productCode: "atlas",
  successUrl: "https://product.test/success",
  cancelUrl: "https://product.test/cancel",
  receiver: {
    audience: "atlas-api",
    billingClientId: "billing",
    consoleClientId: "console",
  },
};
function snapshot(overrides = {}) {
  return {
    organizationId: org,
    productCode: "atlas",
    revision: "1",
    confirmedAt: new Date().toISOString(),
    license: {
      active: true,
      productCode: "atlas",
      subscriptionId: sub,
      planCode: "pro",
      licenseStatus: "active",
      validUntil: new Date(Date.now() + 86400000 * 3).toISOString(),
      seatsLimit: 3,
      usageLimit: null,
      features: { reports: true },
      entitlements: { maxUsers: 3 },
    },
    subscription: {
      id: sub,
      organizationId: org,
      productCode: "atlas",
      planCode: "pro",
      planPriceCode: "monthly",
      status: "active",
      currentPeriodEnd: null,
      nextBillingTime: null,
      cancelAtPeriodEnd: false,
      cancellation: null,
      pendingPlanChange: null,
    },
    ...overrides,
  };
}
function transport(handler) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === config.tokenUrl)
      return Response.json({
        access_token: "fixture.token",
        token_type: "Bearer",
        expires_in: 300,
        scope: init.body.get("scope"),
      });
    return handler(String(url), init);
  };
  return calls;
}
test("Node core, Legal and optional receiver import without Nest or TypeORM", () => {
  const script = `const Module=require('node:module');const load=Module._load;Module._load=function(name,...args){if(name==='typeorm'||name.startsWith('@nestjs/'))throw new Error('Unexpected framework '+name);return load.call(this,name,...args)};const sdk=require(${JSON.stringify(require.resolve("../dist"))});sdk.createPaymentsClient(${JSON.stringify(config)});sdk.createPaymentsLegalClient(${JSON.stringify(config)});sdk.createPaymentsReceiver(${JSON.stringify(config)});`;
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});
test("central attempts preserve known UUID, operation, buyer and exact scopes without local persistence", async () => {
  const id = randomUUID();
  const response = {
    attemptId: id,
    operation: "change_plan",
    status: "pending",
    statusFresh: false,
    retryAfterSeconds: 5,
  };
  const calls = transport(() =>
    Response.json(
      { ...response, privateProviderSecret: "must-not-leak" },
      { status: 202 },
    ),
  );
  const client = createPaymentsClient(config);
  const input = {
    idempotencyKey: id,
    organizationId: org,
    userId: user,
    operation: "change_plan",
    expectedSubscriptionId: sub,
    expectedAmountDueNow: "150.00",
    planCode: "pro",
    planPriceCode: "monthly",
  };
  const attempt = await client.attempts.create(input);
  assert.equal(attempt.attemptId, id);
  assert.equal(attempt.privateProviderSecret, undefined);
  const sent = JSON.parse(calls[1].init.body);
  assert.equal(sent.productCode, "atlas");
  assert.equal(sent.userId, user);
  assert.equal(sent.expectedSubscriptionId, sub);
  assert.equal(
    calls[0].init.body.get("scope"),
    "billing.integration.checkout.create billing.subscriptions.manage",
  );
  const upper = await client.attempts.get(id.toUpperCase(), {
    organizationId: org.toUpperCase(),
    userId: user.toUpperCase(),
  });
  assert.equal(upper.attemptId, id);
  await client.attempts.get(id, { organizationId: org, userId: user });
  assert.equal(calls.at(-1).init.method, "GET");
  assert.match(calls.at(-1).url, new RegExp("organizationId=" + org));
  await client.attempts.retry(id, { organizationId: org, userId: user });
  assert.match(calls.at(-1).url, /\/retry\?/);
  assert.equal(calls.at(-1).init.body, "{}");
  await client.attempts.confirm(id, { organizationId: org, userId: user });
  assert.match(calls.at(-1).url, /\/confirm\?/);
});
test("cancels the owned attempt with management scope and validates its result", async () => {
  const id = randomUUID();
  let result = { cancelled: true, privateProviderSecret: "not-for-consumer" };
  const calls = transport(() => Response.json(result));
  const client = createPaymentsClient(config);
  const buyer = { organizationId: org, userId: user };
  assert.deepEqual(await client.attempts.cancel(id, buyer), {
    cancelled: true,
  });
  assert.equal(calls[0].init.body.get("scope"), "billing.subscriptions.manage");
  const request = calls.at(-1);
  const url = new URL(request.url);
  assert.equal(
    url.pathname,
    `/api/v1/billing/integrations/v1/payment-attempts/${id}/cancel`,
  );
  assert.equal(url.searchParams.get("organizationId"), org);
  assert.equal(url.searchParams.get("userId"), user);
  assert.equal(url.searchParams.get("productCode"), "atlas");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body, "{}");
  result = {
    cancelled: false,
    approvalUrl: "https://www.sandbox.paypal.com/approve",
  };
  assert.deepEqual(await client.attempts.cancel(id, buyer), result);
  for (const invalid of [
    null,
    {},
    { cancelled: "true" },
    { cancelled: false, approvalUrl: "http://localhost/approve" },
    { cancelled: false, approvalUrl: null },
    { cancelled: true, approvalUrl: "https://www.paypal.com/approve" },
  ]) {
    result = invalid;
    await assert.rejects(client.attempts.cancel(id, buyer), {
      code: "contract",
    });
  }
  const before = calls.length;
  await assert.rejects(client.attempts.cancel("invalid", buyer), {
    status: 400,
  });
  assert.equal(calls.length, before);
});
test("attempt and subscription parsers preserve only a boolean cancellation intent", async () => {
  const id = randomUUID();
  const change = {
    kind: "upgrade",
    amountDueNow: "150.00",
    currency: "MXN",
    recurringAmount: "600.00",
    nextBillingAt: "2030-05-01T00:00:00Z",
    state: "awaiting_approval",
    effectiveAt: "2030-04-16T00:00:00Z",
    action: "approve_subscription",
    checkoutUrl: "https://www.paypal.com/restore",
    cancellationRequested: true,
    privateRestoreState: "must-not-leak",
  };
  let flag = true;
  const calls = transport((url) => {
    const planChange = { ...change, cancellationRequested: flag };
    return Response.json(
      url.includes("/payment-attempts/")
        ? {
            attemptId: id,
            operation: "change_plan",
            status: "ready",
            statusFresh: true,
            subscriptionId: sub,
            planChange,
          }
        : {
            ...snapshot().subscription,
            pendingPlanChange: {
              ...planChange,
              targetPlanCode: "pro",
              targetPlanPriceCode: "monthly",
              checkoutId: randomUUID(),
              newSubscriptionId: sub,
            },
          },
    );
  });
  const client = createPaymentsClient(config);
  const buyer = { organizationId: org, userId: user };
  for (const accepted of [true, false]) {
    flag = accepted;
    const attempt = await client.attempts.get(id, buyer);
    assert.equal(attempt.planChange.cancellationRequested, accepted);
    assert.equal(attempt.planChange.privateRestoreState, undefined);
    const subscription = await client.subscriptions.current(org);
    assert.equal(
      subscription.pendingPlanChange.cancellationRequested,
      accepted,
    );
    assert.equal(subscription.pendingPlanChange.privateRestoreState, undefined);
  }
  flag = "true";
  await assert.rejects(client.attempts.get(id, buyer), { code: "contract" });
  await assert.rejects(client.subscriptions.current(org), { code: "contract" });
  const before = calls.length;
  await assert.rejects(
    client.attempts.get(id, { ...buyer, userId: "invalid" }),
    { status: 400 },
  );
  assert.equal(calls.length, before);
});
test("attempt rejection keeps its durable ID and canonical no-action removes stale redirect", async () => {
  const id = randomUUID();
  transport(() =>
    Response.json(
      {
        attemptId: id,
        operation: "checkout",
        status: "rejected",
        statusFresh: true,
        errorCode: "BILLING_CHECKOUT_REJECTED",
      },
      { status: 422 },
    ),
  );
  const result = await createPaymentsClient(config).attempts.create({
    idempotencyKey: id,
    organizationId: org,
    userId: user,
    operation: "checkout",
    planCode: "pro",
    planPriceCode: "monthly",
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.attemptId, id);
  transport(() =>
    Response.json({
      attemptId: id,
      operation: "change_plan",
      status: "ready",
      statusFresh: true,
      checkoutUrl: "https://www.paypal.com/old",
      planChange: {
        state: "effective",
        effectiveAt: new Date().toISOString(),
        action: "none",
        checkoutUrl: null,
      },
    }),
  );
  assert.equal(
    (
      await createPaymentsClient(config).attempts.get(id, {
        organizationId: org,
        userId: user,
      })
    ).checkoutUrl,
    undefined,
  );
});
test("snapshots require product/organization coherence and optional copy access expires honestly", async () => {
  const value = snapshot();
  const calls = transport(() => Response.json(value));
  const result = await createPaymentsClient(config).snapshots.current(org);
  assert.equal(result.revision, "1");
  const upper = await createPaymentsClient(config).snapshots.current(
    org.toUpperCase(),
  );
  assert.equal(upper.organizationId, org);
  const request = calls
    .filter((call) => call.url.includes("/snapshots?"))
    .at(-1);
  assert.equal(new URL(request.url).searchParams.get("organization_id"), org);

  assert.equal(
    calls[0].init.body.get("scope"),
    "billing.integration.licenses.read billing.subscriptions.manage",
  );
  const fresh = snapshotAccess(result);
  assert.equal(fresh.active, true);
  assert.equal(
    Date.parse(fresh.validUntil),
    Date.parse(value.confirmedAt) + 86400000,
  );
  assert.equal(
    snapshotAccess({
      ...value,
      confirmedAt: new Date(Date.now() - 86400001).toISOString(),
    }).reason,
    "confirmation_expired",
  );
  assert.equal(snapshotAccess(null).reason, "not_confirmed");
  assert.throws(() =>
    snapshotAccess({
      ...value,
      confirmedAt: new Date(Date.now() + 301000).toISOString(),
    }),
  );
  assert.throws(() =>
    snapshotAccess({
      ...value,
      subscription: { ...value.subscription, id: randomUUID() },
    }),
  );
});
test("optional Node webhook authenticates signature/introspection and delegates atomic revision apply, including failures", async () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = {
    ...pair.publicKey.export({ format: "jwk" }),
    kid: "one",
    alg: "RS256",
    use: "sig",
  };
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "at+jwt", kid: "one" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: config.issuer,
      aud: "atlas-api",
      client_id: "billing",
      sub: "billing",
      grant_type: "client_credentials",
      scope: "billing.webhooks.deliver",
      iat: now,
      exp: now + 300,
    }),
  ).toString("base64url");
  const signed = header + "." + payload;
  const token =
    signed +
    "." +
    sign("RSA-SHA256", Buffer.from(signed), pair.privateKey).toString(
      "base64url",
    );
  let active = true;
  global.fetch = async (url) =>
    Response.json(
      String(url).endsWith("/introspect")
        ? {
            active,
            aud: "atlas-api",
            client_id: "billing",
            scope: "billing.webhooks.deliver",
            exp: now + 300,
          }
        : { keys: [key] },
    );
  let saved,
    fail = false,
    calls = 0;
  const receiver = createPaymentsReceiver(config, {
    onSnapshot: async (value) => {
      calls++;
      if (fail) throw new Error("Host storage unavailable");
      if (saved && BigInt(saved.revision) >= BigInt(value.revision))
        return { applied: false };
      saved = value;
      return { applied: true };
    },
  });
  const headers = { authorization: "Bearer " + token, timestamp: String(now) };
  const event = {
    ...snapshot(),
    type: "billing.license.updated",
    checkouts: [],
  };
  assert.deepEqual(await receiver.receive(headers, event), {
    received: true,
    applied: true,
  });
  assert.deepEqual(await receiver.receive(headers, event), {
    received: true,
    applied: false,
  });
  assert.equal(saved.confirmedAt, event.confirmedAt);
  active = false;
  await assert.rejects(receiver.receive(headers, event), { status: 401 });
  assert.equal(calls, 2);
  active = true;
  fail = true;
  await assert.rejects(
    receiver.receive(headers, { ...event, revision: "2" }),
    /Host storage/,
  );
  fail = false;
  assert.equal(
    (await receiver.receive(headers, { ...event, revision: "2" })).applied,
    true,
  );
  await assert.rejects(createPaymentsReceiver(config).receive(headers, event), {
    status: 404,
  });
});
test("Legal works directly in Node and binds verified context to prepared request", async () => {
  const requestId = randomUUID(),
    identitySourceId = randomUUID(),
    legalAcceptanceId = randomUUID();
  const document = {
    documentId: randomUUID(),
    documentVersionId: randomUUID(),
    contentHash: "a".repeat(64),
    title: "Terms",
    version: "1",
    kind: "terms",
    artifacts: { html: { url: "https://legal.test/terms" } },
  };
  const calls = transport((url) =>
    Response.json(
      url.endsWith("/acceptance-requests")
        ? {
            requestId,
            identitySourceId,
            productCode: "atlas",
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            documents: [document],
          }
        : {
            requestId,
            identitySourceId,
            legalAcceptanceId,
            productCode: "atlas",
            accepted: true,
          },
    ),
  );
  const legal = createPaymentsLegalClient({
    ...config,
    legal: {
      baseUrl: "https://legal.test",
      audience: "legal-api",
      resource: "https://legal.test",
      verificationClientId: "legal",
    },
  });
  const context = {
    organizationId: org,
    subjectId: user,
    sessionId: randomUUID(),
  };
  const prepared = await legal.prepare(context, randomUUID());
  assert.equal(prepared.requestId, requestId);
  assert.equal(JSON.parse(calls[1].init.body).subjectId, user);
  assert.equal(
    (
      await legal.accept(context, {
        requestId,
        idempotencyKey: randomUUID(),
        confirmations: [
          {
            documentVersionId: document.documentVersionId,
            contentHash: document.contentHash,
            accepted: true,
          },
        ],
      })
    ).legalAcceptanceId,
    legalAcceptanceId,
  );
});

test("compatibility preflight checks the deployed contract using a read-only catalog-scoped request", async () => {
  const { MINIMUM_BILLING_VERSION, BILLING_API_CONTRACT } = require("../dist");
  const calls = transport((url, init) => {
    assert.equal(
      url,
      "https://billing.test/api/v1/billing/integrations/v1/compatibility",
    );
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    return Response.json({
      contract: BILLING_API_CONTRACT,
      billingVersion: MINIMUM_BILLING_VERSION,
    });
  });
  assert.deepEqual(await createPaymentsClient(config).verifyCompatibility(), {
    contract: BILLING_API_CONTRACT,
    billingVersion: MINIMUM_BILLING_VERSION,
  });
  assert.equal(
    calls[0].init.body.get("scope"),
    "billing.integration.catalog.read",
  );
  assert.equal(calls.length, 2);
});

test("compatibility accepts later stable Billing 1.x but rejects old, future-major, malformed and missing contracts", async () => {
  for (const version of ["1.0.1", "1.0.2", "1.10.0"]) {
    transport(() =>
      Response.json({
        contract: "billing.integrations.v1",
        billingVersion: version,
      }),
    );
    assert.equal(
      (await createPaymentsClient(config).verifyCompatibility()).billingVersion,
      version,
    );
  }
  for (const value of [
    null,
    {},
    { contract: "other", billingVersion: "1.0.1" },
    ...[
      "0.9.0",
      "1.0.0",
      "2.0.0",
      "1.0.1-beta.1",
      "01.0.1",
      "1.0.1\n",
      "1.0.999999999999999999999999",
    ].map((billingVersion) => ({
      contract: "billing.integrations.v1",
      billingVersion,
    })),
  ]) {
    transport(() => Response.json(value));
    await assert.rejects(createPaymentsClient(config).verifyCompatibility(), {
      code: "compatibility",
      status: 503,
    });
  }
});

test("compatibility preflight stops on absent endpoint, forbidden access and transport failure without retry", async () => {
  for (const status of [401, 403, 404, 503]) {
    const calls = transport(() =>
      Response.json({ error: "fixture" }, { status }),
    );
    await assert.rejects(createPaymentsClient(config).verifyCompatibility(), {
      code: "http",
      status,
    });
    assert.equal(calls.length, 2);
  }
  const calls = transport(() => {
    throw new Error("unavailable");
  });
  await assert.rejects(createPaymentsClient(config).verifyCompatibility(), {
    code: "transport",
  });
  assert.equal(calls.length, 2);
});
