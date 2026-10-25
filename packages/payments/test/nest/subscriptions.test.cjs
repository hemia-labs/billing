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
  const service = new PaymentsService({ ...options });
  service.client.subscriptions.current = async () => ({
    id: subscriptionId,
    status: "active",
    planCode: "basic",
    planPriceCode: "monthly",
    cancelAtPeriodEnd: false,
  });
  return { service };
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
test("durable plan-change replay preserves the source, payload and canonical scheduling through central transport", async () => {
  const f = fixture();
  const key = dto.idempotencyKey;
  const receipt = {
    attemptId: key,
    operation: "change_plan",
    status: "ready",
    statusFresh: false,
    subscriptionId,
    planCode: "pro",
    planChange: {
      state: "awaiting_approval",
      effectiveAt: "2026-12-22T10:00:00.000Z",
    },
  };
  const sent = [];
  f.service.client.attempts.create = async (input) => {
    sent.push(input);
    return receipt;
  };
  const input = { ...dto, expectedSubscriptionId: subscriptionId };
  assert.deepEqual(
    await f.service.createAttempt(c, input, "change_plan"),
    receipt,
  );
  f.service.client.subscriptions.current = async () =>
    assert.fail("Changed current must not be consulted for replay");
  assert.deepEqual(
    await f.service.createAttempt(c, input, "change_plan"),
    receipt,
  );
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[0].expectedSubscriptionId, subscriptionId);
  assert.equal(sent[0].userId, subject);
  f.service.client.attempts.get = async (id, buyer) => {
    assert.equal(id, key);
    assert.equal(buyer.organizationId, org);
    return {
      ...receipt,
      statusFresh: true,
      planChange: {
        state: "scheduled",
        effectiveAt: receipt.planChange.effectiveAt,
      },
    };
  };
  assert.equal(
    (await f.service.getAttempt(c, key)).planChange.state,
    "scheduled",
  );
  const { PaymentsError } = require("../../dist");
  f.service.client.attempts.create = async () => {
    throw new PaymentsError("http", 409);
  };
  await assert.rejects(
    f.service.createAttempt(c, dto),
    (error) => error.getStatus() === 409,
  );
});

test("normal checkout delegates existing-paid-access rejection to Billing without creating a provider contract locally", async () => {
  const { PaymentsError } = require("../../dist");
  const f = fixture();
  f.service.client.checkout.create = async () =>
    assert.fail("must never create a second subscription locally");
  let requests = 0;
  f.service.client.attempts.create = async (input) => {
    requests++;
    assert.equal(input.operation, "checkout");
    assert.equal(input.organizationId, org);
    throw new PaymentsError("http", 409);
  };
  await assert.rejects(
    f.service.createAttempt(c, dto),
    (error) => error.getStatus() === 409,
  );
  assert.equal(requests, 1);
  assert.equal(f.service.storage, undefined);
});

test("subscription routes authorize management and retries reauthorize centrally stored change operations", async () => {
  const f = fixture();
  const auth = [];
  f.service.options.authorize = async (_, operation) => {
    auth.push(operation);
    return c;
  };
  await new PaymentsController(f.service).subscription({});
  assert.deepEqual(auth, ["subscription.manage"]);
  const id = randomUUID();
  f.service.client.attempts.get = async (attemptId, buyer) => {
    assert.equal(attemptId, id);
    assert.deepEqual(buyer, { organizationId: org, userId: subject });
    return {
      attemptId,
      operation: "change_plan",
      status: "pending",
      statusFresh: false,
    };
  };
  auth.length = 0;
  await f.service.authorizeAttempt({}, id);
  assert.deepEqual(auth, ["checkout.manage", "subscription.manage"]);
  f.service.client.attempts.get = async () => {
    const { PaymentsError } = require("../../dist");
    throw new PaymentsError("http", 404);
  };
  await assert.rejects(
    f.service.authorizeAttempt({}, randomUUID()),
    (error) => error.getStatus() === 404,
  );
});

test("ambiguous transport recovers the known central key after the current subscription changes", async () => {
  const { PaymentsError } = require("../../dist");
  const f = fixture();
  const key = dto.idempotencyKey;
  f.service.client.attempts.create = async (input) => {
    assert.equal(input.idempotencyKey, key);
    assert.equal(input.expectedSubscriptionId, subscriptionId);
    throw new PaymentsError("transport");
  };
  await assert.rejects(
    f.service.createAttempt(
      c,
      { ...dto, expectedSubscriptionId: subscriptionId },
      "change_plan",
    ),
    (error) => error.getStatus() === 503,
  );
  f.service.client.subscriptions.current = async () =>
    assert.fail("retry must never derive a different source");
  f.service.client.attempts.retry = async (id, buyer) => {
    assert.equal(id, key);
    assert.deepEqual(buyer, { organizationId: org, userId: subject });
    return { attemptId: id, status: "ready", statusFresh: false };
  };
  assert.equal((await f.service.retryAttempt(c, key)).attemptId, key);
  assert.equal(f.service.storage, undefined);
});

test("cross-device resume preserves only Billing's canonical approval metadata for the current organization", async () => {
  const f = fixture();
  const summary = {
    id: subscriptionId,
    pendingPlanChange: {
      state: "awaiting_approval",
      checkoutId: randomUUID(),
      attemptId: randomUUID(),
      targetPlanCode: "pro",
      targetPlanPriceCode: "monthly",
      action: "approve_payment",
      checkoutUrl: null,
    },
  };
  const organizations = [];
  f.service.client.subscriptions.current = async (organization) => {
    organizations.push(organization);
    return summary;
  };
  f.service.client.attempts.get = async (id, buyer) => {
    assert.equal(id, summary.pendingPlanChange.attemptId);
    assert.deepEqual(buyer, { organizationId: org, userId: subject });
    return {
      attemptId: id,
      operation: "change_plan",
      status: "ready",
      statusFresh: true,
      checkoutId: summary.pendingPlanChange.checkoutId,
      subscriptionId,
      planCode: "pro",
      planPriceCode: "monthly",
      planChange: {
        state: summary.pendingPlanChange.state,
        action: summary.pendingPlanChange.action,
        checkoutUrl: summary.pendingPlanChange.checkoutUrl,
      },
    };
  };
  assert.deepEqual(await f.service.getSubscription(c), summary);
  assert.deepEqual(organizations, [org]);
  summary.pendingPlanChange.checkoutUrl =
    "https://www.sandbox.paypal.com/current-payment";
  assert.equal(
    (await f.service.getSubscription(c)).pendingPlanChange.checkoutUrl,
    summary.pendingPlanChange.checkoutUrl,
  );
  summary.pendingPlanChange.action = "none";
  summary.pendingPlanChange.checkoutUrl = null;
  assert.equal(
    (await f.service.getSubscription(c)).pendingPlanChange.checkoutUrl,
    null,
  );
});

test("stale subscription confirmations retain central conflicts and cancellation rejects stale source before mutation", async () => {
  const { PaymentsError } = require("../../dist");
  const f = fixture();
  const stale = randomUUID();
  f.service.client.subscriptions.cancel = async () =>
    assert.fail("stale cancellation must not reach Billing");
  await assert.rejects(
    f.service.cancelSubscription(c, {
      idempotencyKey: randomUUID(),
      expectedSubscriptionId: stale,
    }),
    /SUBSCRIPTION_CHANGED/,
  );
  f.service.client.attempts.create = async (input) => {
    assert.equal(input.expectedSubscriptionId, stale);
    throw new PaymentsError("http", 409);
  };
  await assert.rejects(
    f.service.createAttempt(
      c,
      { ...dto, expectedSubscriptionId: stale },
      "change_plan",
    ),
    (error) => error.getStatus() === 409,
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
  assert.equal(f.service.storage, undefined);
});

test("prorated attempts bind accepted money and only explicit confirmation advances PayPal", async () => {
  const f = fixture();
  const key = dto.idempotencyKey;
  const quote = {
    kind: "upgrade",
    amountDueNow: "150.00",
    currency: "MXN",
    recurringAmount: "600.00",
    effectiveAt: "2026-10-23T12:00:00Z",
    nextBillingAt: "2026-11-01T00:00:00Z",
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
  const initial = {
    attemptId: key,
    operation: "change_plan",
    status: "ready",
    statusFresh: true,
    planChange: {
      ...quote,
      state: "awaiting_approval",
      action: "approve_subscription",
      checkoutUrl: "https://www.sandbox.paypal.com/revise",
    },
  };
  f.service.client.attempts.create = async (input) => {
    assert.equal(input.expectedAmountDueNow, "150.00");
    assert.equal(input.expectedSubscriptionId, subscriptionId);
    return initial;
  };
  const payload = {
    ...dto,
    expectedSubscriptionId: subscriptionId,
    expectedAmountDueNow: "150.00",
  };
  assert.deepEqual(
    (await f.service.createAttempt(c, payload, "change_plan")).planChange,
    initial.planChange,
  );
  const { PaymentsError } = require("../../dist");
  f.service.client.attempts.create = async () => {
    throw new PaymentsError("http", 409);
  };
  await assert.rejects(
    f.service.createAttempt(
      c,
      { ...payload, expectedAmountDueNow: "200.00" },
      "change_plan",
    ),
    (error) => error.getStatus() === 409,
  );
  let confirms = 0;
  f.service.client.attempts.get = async (id, buyer) => {
    assert.equal(id, key);
    assert.equal(buyer.userId, subject);
    return initial;
  };
  f.service.client.attempts.confirm = async () => {
    confirms++;
    return {
      ...initial,
      planChange: {
        ...initial.planChange,
        action: "approve_payment",
        checkoutUrl: "https://www.sandbox.paypal.com/pay",
      },
    };
  };
  await f.service.getAttempt(c, key);
  assert.equal(confirms, 0);
  const paying = await new PaymentsController(f.service).confirm({}, key);
  assert.equal(confirms, 1);
  assert.equal(
    paying.planChange.checkoutUrl,
    "https://www.sandbox.paypal.com/pay",
  );
  f.service.client.attempts.confirm = async () => ({
    ...initial,
    planChange: {
      ...initial.planChange,
      state: "effective",
      action: "none",
      checkoutUrl: null,
    },
  });
  const done = await f.service.confirmAttempt(c, key);
  assert.equal(done.planChange.state, "effective");
  assert.equal(done.planChange.checkoutUrl, null);
  f.service.client.attempts.get = async () => {
    throw new PaymentsError("http", 404);
  };
  await assert.rejects(
    new PaymentsController(f.service).confirm({}, key),
    (error) => error.getStatus() === 404,
  );
});
