const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
require("reflect-metadata");
const { PaymentsService } = require("../../dist/nestjs");
const { PaymentsController } = require("../../dist/nestjs/controllers");
const { cancellationInput } = require("../../dist/nestjs/validation");
const org = randomUUID(),
  subject = randomUUID(),
  subscriptionId = randomUUID();
const c = { organizationId: org, subjectId: subject };
const dto = {
  idempotencyKey: randomUUID(),
  planCode: "pro",
  planPriceCode: "monthly",
};
const options = {
  connection: {
    issuer: "https://identity.test",
    tokenUrl: "https://identity.test/oauth/token",
    baseUrl: "https://billing.test/api/v1",
    audience: "billing-api",
    clientId: "test",
    productCode: "test",
    successUrl: "https://product.test/success",
    cancelUrl: "https://product.test/cancel",
  },
  clientSecret: "test-only",
  dataSource: {},
  authorize: async () => c,
  receiver: {
    jwksUrl: "https://identity.test/jwks",
    introspectionUrl: "https://identity.test/introspect",
  },
};
function fixture() {
  let row = null;
  const manager = {
    query: async (sql, args) => {
      if (sql.startsWith("SELECT pg_advisory")) return [];
      if (sql.startsWith("SELECT * FROM public.payments_checkout_attempts"))
        return row ? [row] : [];
      if (sql.startsWith("INSERT")) {
        row = {
          id: args[0],
          organization_id: args[1],
          subject_id: args[2],
          product_code: args[3],
          idempotency_key: args[4],
          request_hash: args[5],
          request_payload: JSON.parse(args[6]),
          status: "pending",
          status_checked_at: null,
        };
        return [row];
      }
      if (sql.startsWith("WITH changed")) {
        Object.assign(row, {
          status: "ready",
          checkout_id: args[3],
          subscription_id: args[4],
          checkout_url: args[5],
          checkout_status: args[6],
        });
        if (args[7]) row.request_payload.planChange = JSON.parse(args[7]);
        return [row];
      }
      if (sql.includes("request_payload=jsonb_set")) {
        row.request_payload.planChange = JSON.parse(args[5]);
        row.status_checked_at = new Date();
        if (args[9] && args[10] !== null) row.checkout_url = args[10];
        return [];
      }
      throw new Error("Unexpected SQL: " + sql);
    },
  };
  const store = {
    transaction: async (_, work) => work(manager),
    byId: async (_, organization, id) =>
      row && row.id === id && row.organization_id === organization ? row : null,
  };
  const service = new PaymentsService(options, store);
  service.client.catalog.listPlans = async () => [
    { code: "pro", prices: [{ code: "monthly" }] },
  ];
  service.client.subscriptions.current = async () => ({
    id: subscriptionId,
    status: "active",
    planCode: "basic",
    planPriceCode: "monthly",
    cancelAtPeriodEnd: false,
  });
  return { service, row: () => row };
}
test("cancellation boundaries reject browser-supplied identities and bind current source to the verified actor", async () => {
  const key = randomUUID();
  assert.throws(() =>
    cancellationInput({ idempotencyKey: key, subscriptionId }),
  );
  assert.throws(() =>
    cancellationInput({ idempotencyKey: key, actorUserId: subject }),
  );
  assert.throws(() => cancellationInput({ idempotencyKey: key, reason: " " }));
  const f = fixture();
  let sent;
  f.service.client.subscriptions.cancel = async (id, input) => {
    sent = { id, input };
    return { organizationId: org, cancellation: { state: "pending" } };
  };
  await f.service.cancelSubscription(c, {
    idempotencyKey: key,
    expectedSubscriptionId: subscriptionId,
  });
  assert.deepEqual(sent, {
    id: subscriptionId,
    input: { idempotencyKey: key, actorUserId: subject },
  });
});
test("durable plan-change retries preserve source, receipt and canonical scheduling without treating old active access as success", async () => {
  const f = fixture();
  let calls = 0;
  f.service.client.subscriptions.changePlan = async (source, input) => {
    calls++;
    assert.equal(source, subscriptionId);
    assert.equal(input.userId, subject);
    return {
      checkoutId: randomUUID(),
      newSubscriptionId: source,
      checkoutUrl: "https://www.sandbox.paypal.com/approve",
      state: "awaiting_approval",
      effectiveAt: "2026-12-22T10:00:00.000Z",
    };
  };
  const initial = await f.service.createAttempt(
    c,
    { ...dto, expectedSubscriptionId: subscriptionId },
    "change_plan",
  );
  assert.equal(initial.subscriptionId, subscriptionId);
  assert.equal(initial.planCode, "pro");
  assert.equal(initial.planChange.state, "awaiting_approval");
  f.service.client.subscriptions.current = async () => {
    throw new Error("Changed current must not be consulted for replay");
  };
  assert.deepEqual(
    await f.service.createAttempt(
      c,
      { ...dto, expectedSubscriptionId: subscriptionId },
      "change_plan",
    ),
    initial,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    f.service.createAttempt(c, dto),
    /IDEMPOTENCY_KEY_REUSED/,
  );
  f.service.client.checkout.status = async () => ({
    checkoutId: initial.checkoutId,
    subscriptionId,
    checkoutStatus: "approved",
    subscriptionStatus: "active",
    planChange: {
      state: "scheduled",
      effectiveAt: initial.planChange.effectiveAt,
    },
  });
  assert.equal(
    (await f.service.getAttempt(c, initial.attemptId)).planChange.state,
    "scheduled",
  );
});
test("normal checkout rejects existing paid access and does not create a provider contract", async () => {
  const f = fixture();
  f.service.client.licenses.resolve = async () => ({ active: true });
  f.service.client.checkout.create = async () =>
    assert.fail("must never create a second subscription");
  await assert.rejects(
    f.service.createAttempt(c, dto),
    /SUBSCRIPTION_CHANGE_REQUIRED/,
  );
  assert.equal(f.row(), null);
});
test("subscription routes authorize management and retries reauthorize stored change operations", async () => {
  const f = fixture();
  const auth = [];
  f.service.options.authorize = async (_, operation) => {
    auth.push(operation);
    return c;
  };
  await new PaymentsController(f.service).subscription({});
  assert.deepEqual(auth, ["subscription.manage"]);
  f.service.client.subscriptions.changePlan = async () => ({
    checkoutId: randomUUID(),
    newSubscriptionId: subscriptionId,
    checkoutUrl: "https://www.sandbox.paypal.com/approve",
    state: "awaiting_approval",
    effectiveAt: "2026-12-22T10:00:00.000Z",
  });
  const attempt = await f.service.createAttempt(
    c,
    { ...dto, expectedSubscriptionId: subscriptionId },
    "change_plan",
  );
  auth.length = 0;
  await f.service.authorizeAttempt({}, attempt.attemptId);
  assert.deepEqual(auth, ["checkout.manage", "subscription.manage"]);
  await assert.rejects(f.service.authorizeAttempt({}, randomUUID()));
});

test("ambiguous plan-change transport retries the persisted source after the current subscription changes", async () => {
  const { PaymentsError } = require("../../dist");
  const f = fixture();
  let calls = 0;
  f.service.client.subscriptions.changePlan = async (source, request) => {
    assert.equal(source, subscriptionId);
    assert.equal(request.idempotencyKey, dto.idempotencyKey);
    if (++calls === 1) throw new PaymentsError("transport");
    return {
      checkoutId: randomUUID(),
      newSubscriptionId: source,
      checkoutUrl: "https://www.sandbox.paypal.com/approve",
      state: "awaiting_approval",
      effectiveAt: "2026-12-22T10:00:00.000Z",
    };
  };
  const pending = await f.service.createAttempt(
    c,
    { ...dto, expectedSubscriptionId: subscriptionId },
    "change_plan",
  );
  assert.equal(pending.status, "pending");
  f.service.client.subscriptions.current = async () =>
    assert.fail("retry must never derive a different source");
  const result = await f.service.retryAttempt(c, pending.attemptId);
  assert.equal(result.status, "ready");
  assert.equal(result.subscriptionId, subscriptionId);
  assert.equal(calls, 2);
});
test("cross-device resume exposes an approval link only for the canonical checkout and current actor", async () => {
  const f = fixture();
  const checkoutId = randomUUID(),
    attemptId = randomUUID();
  const summary = {
    id: subscriptionId,
    pendingPlanChange: { state: "awaiting_approval", checkoutId },
  };
  f.service.client.subscriptions.current = async () => summary;
  const scopes = [];
  f.service.storage.transaction = async (scope, work) => {
    scopes.push(scope);
    return work({
      query: async (sql, args) => {
        assert.match(sql, /subject_id=\$3 AND checkout_id=\$4/);
        assert.deepEqual(args, [org, "test", subject, checkoutId]);
        return [
          {
            id: attemptId,
            checkout_url: "https://www.sandbox.paypal.com/approve",
          },
        ];
      },
    });
  };
  const result = await f.service.getSubscription(c);
  assert.equal(result.pendingPlanChange.attemptId, attemptId);
  assert.equal(
    result.pendingPlanChange.checkoutUrl,
    "https://www.sandbox.paypal.com/approve",
  );
  assert.deepEqual(scopes, [{ kind: "user", context: c }]);
  summary.pendingPlanChange.action = "approve_payment";
  summary.pendingPlanChange.checkoutUrl =
    "https://www.sandbox.paypal.com/pay-current-order";
  assert.equal(
    (await f.service.getSubscription(c)).pendingPlanChange.checkoutUrl,
    summary.pendingPlanChange.checkoutUrl,
  );
  summary.pendingPlanChange.checkoutUrl = null;
  assert.equal(
    (await f.service.getSubscription(c)).pendingPlanChange.checkoutUrl,
    null,
  );
  delete summary.pendingPlanChange.action;
  assert.equal(
    (await f.service.getSubscription(c)).pendingPlanChange.checkoutUrl,
    null,
  );
  delete summary.pendingPlanChange.checkoutUrl;
  assert.equal(
    (await f.service.getSubscription(c)).pendingPlanChange.checkoutUrl,
    "https://www.sandbox.paypal.com/approve",
  );
  summary.pendingPlanChange.state = "scheduled";
  assert.equal(
    (await f.service.getSubscription(c)).pendingPlanChange.checkoutUrl,
    null,
  );
  summary.pendingPlanChange.action = "none";
  assert.equal(
    (await f.service.getSubscription(c)).pendingPlanChange.checkoutUrl,
    null,
  );
});

test("stale subscription confirmations reject cancellation and change before any provider mutation", async () => {
  const f = fixture();
  const stale = randomUUID();
  f.service.client.subscriptions.cancel = async () =>
    assert.fail("stale cancellation must not reach Billing");
  f.service.client.subscriptions.changePlan = async () =>
    assert.fail("stale plan change must not reach Billing");
  await assert.rejects(
    f.service.cancelSubscription(c, {
      idempotencyKey: randomUUID(),
      expectedSubscriptionId: stale,
    }),
    /SUBSCRIPTION_CHANGED/,
  );
  await assert.rejects(
    f.service.createAttempt(
      c,
      { ...dto, expectedSubscriptionId: stale },
      "change_plan",
    ),
    /SUBSCRIPTION_CHANGED/,
  );
  await assert.rejects(
    f.service.createAttempt(c, dto, "change_plan"),
    /Invalid expected subscription/,
  );
  await assert.rejects(
    f.service.createAttempt(c, {
      ...dto,
      expectedSubscriptionId: subscriptionId,
    }),
    /Invalid expected subscription/,
  );
  assert.equal(f.row(), null);
});

test("prorated attempt binds approved amount and only POST confirmation can advance PayPal payment", async () => {
  const f = fixture();
  let verifies = 0;
  const quote = {
    kind: "upgrade",
    amountDueNow: "150.00",
    currency: "MXN",
    recurringAmount: "600.00",
    effectiveAt: "2026-10-23T12:00:00Z",
    nextBillingAt: "2026-11-01T00:00:00Z",
  };
  const initialChange = {
    ...quote,
    state: "awaiting_approval",
    action: "approve_subscription",
    checkoutUrl: "https://www.sandbox.paypal.com/revise",
  };
  f.service.client.subscriptions.planChangeQuote = async (id, plan, price) => {
    assert.equal(id, subscriptionId);
    assert.equal(plan, "pro");
    assert.equal(price, "monthly");
    return quote;
  };
  assert.deepEqual(
    await new PaymentsController(f.service).planChangeQuote(
      {},
      { targetPlanCode: "pro", targetPlanPriceCode: "monthly" },
    ),
    quote,
  );
  f.service.client.subscriptions.changePlan = async (_, input) => {
    assert.equal(input.expectedAmountDueNow, "150.00");
    return {
      checkoutId: randomUUID(),
      newSubscriptionId: subscriptionId,
      checkoutUrl: initialChange.checkoutUrl,
      state: initialChange.state,
      effectiveAt: quote.effectiveAt,
      planChange: initialChange,
    };
  };
  const payload = {
    ...dto,
    expectedSubscriptionId: subscriptionId,
    expectedAmountDueNow: "150.00",
  };
  const initial = await f.service.createAttempt(c, payload, "change_plan");
  assert.deepEqual(initial.planChange, initialChange);
  await assert.rejects(
    f.service.createAttempt(
      c,
      { ...payload, expectedAmountDueNow: "200.00" },
      "change_plan",
    ),
    /IDEMPOTENCY_KEY_REUSED/,
  );
  const status = {
    checkoutId: initial.checkoutId,
    subscriptionId,
    checkoutStatus: "created",
    subscriptionStatus: "pending",
    planChange: initialChange,
  };
  f.service.client.checkout.status = async () => status;
  f.service.client.checkout.verify = async () => {
    verifies++;
    return {
      ...status,
      planChange: {
        ...initialChange,
        action: "approve_payment",
        checkoutUrl: "https://www.sandbox.paypal.com/pay",
      },
    };
  };
  await f.service.getAttempt(c, initial.attemptId);
  assert.equal(verifies, 0);
  const paying = await new PaymentsController(f.service).confirm(
    {},
    initial.attemptId,
  );
  assert.equal(verifies, 1);
  assert.equal(paying.checkoutUrl, "https://www.sandbox.paypal.com/pay");
  f.service.client.checkout.verify = async () => ({
    ...status,
    planChange: {
      ...initialChange,
      state: "effective",
      action: "none",
      checkoutUrl: null,
    },
  });
  const done = await f.service.confirmAttempt(c, initial.attemptId);
  assert.equal(done.planChange.state, "effective");
  assert.equal(done.checkoutUrl, undefined);
  assert.equal(f.row().checkout_url, "https://www.sandbox.paypal.com/pay");
  const cached = await f.service.retryAttempt(c, initial.attemptId);
  assert.equal(cached.checkoutUrl, undefined);
  assert.equal(cached.planChange.checkoutUrl, null);
  f.service.client.checkout.status = async () => {
    throw new Error("Billing unavailable");
  };
  const unavailable = await f.service.getAttempt(c, initial.attemptId);
  assert.equal(unavailable.statusFresh, false);
  assert.equal(unavailable.errorCode, "BILLING_STATUS_UNAVAILABLE");
  assert.equal(unavailable.checkoutUrl, undefined);
  await assert.rejects(
    f.service.confirmAttempt(
      { ...c, subjectId: randomUUID() },
      initial.attemptId,
    ),
    /not found/,
  );
});
