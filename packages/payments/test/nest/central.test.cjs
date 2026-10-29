const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Module } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
require("reflect-metadata");
const { PaymentsModule, PaymentsService } = require("../../dist/nestjs");
const { PaymentsController } = require("../../dist/nestjs/controllers");
const c = { organizationId: randomUUID(), subjectId: randomUUID() };
const config = {
  issuer: "https://identity.test",
  tokenUrl: "https://identity.test/oauth/token",
  baseUrl: "https://billing.test/api/v1",
  audience: "billing-api",
  clientId: "consumer",
  productCode: "atlas",
  successUrl: "https://product.test/success",
  cancelUrl: "https://product.test/cancel",
};
function fixture() {
  const auth = [];
  const service = new PaymentsService({
    connection: config,
    clientSecret: "test-only",
    authorize: async (_, operation) => {
      auth.push(operation);
      return c;
    },
    receiver: {},
  });
  return { service, auth };
}
test("Nest bootstraps without TypeORM or a database provider", async () => {
  class HostModule {}
  Module({
    imports: [
      PaymentsModule.forRootAsync({
        useFactory: () => ({
          connection: config,
          clientSecret: "test-only",
          authorize: async () => c,
        }),
      }),
    ],
  })(HostModule);
  const app = await NestFactory.createApplicationContext(HostModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const service = app.get(PaymentsService);
    assert.equal(service.options.dataSource, undefined);
    assert.deepEqual(service.ready(), { ready: true, authority: "billing" });
  } finally {
    await app.close();
  }
});
test("central attempts derive buyer and URLs from verified context; UUID is known before transport", async () => {
  const { service } = fixture();
  const key = randomUUID();
  let sent;
  service.options.returnUrls = async (context, id) => {
    assert.deepEqual(context, c);
    assert.equal(id, key);
    return {
      successUrl: `https://product.test/success?attemptId=${id}`,
      cancelUrl: "https://product.test/cancel",
    };
  };
  service.client.attempts.create = async (input) => {
    sent = input;
    return {
      attemptId: key,
      status: "pending",
      statusFresh: false,
      operation: "change_plan",
    };
  };
  const dto = {
    idempotencyKey: key,
    expectedSubscriptionId: randomUUID(),
    planCode: "pro",
    planPriceCode: "monthly",
    expectedAmountDueNow: "150.00",
  };
  const response = await service.createAttempt(c, dto, "change_plan");
  assert.equal(response.attemptId, key);
  assert.equal(sent.organizationId, c.organizationId);
  assert.equal(sent.userId, c.subjectId);
  assert.equal(sent.expectedAmountDueNow, "150.00");
  assert.equal(sent.operation, "change_plan");
  await assert.rejects(
    service.createAttempt(c, { ...dto, organizationId: randomUUID() }),
  );
});
test("central operation determines management authorization, and GET cannot confirm", async () => {
  const { service, auth } = fixture();
  const id = randomUUID();
  let gets = 0,
    confirms = 0;
  service.client.attempts.get = async (attempt, buyer) => {
    assert.equal(attempt, id);
    assert.deepEqual(buyer, {
      organizationId: c.organizationId,
      userId: c.subjectId,
    });
    gets++;
    return {
      attemptId: id,
      operation: "change_plan",
      status: "pending",
      statusFresh: false,
    };
  };
  service.client.attempts.confirm = async (attempt, buyer) => {
    assert.equal(attempt, id);
    assert.equal(buyer.userId, c.subjectId);
    confirms++;
    return { attemptId: id, status: "ready", statusFresh: true };
  };
  const controller = new PaymentsController(service);
  await controller.get({}, id);
  assert.equal(confirms, 0);
  assert.deepEqual(auth, ["checkout.manage", "subscription.manage"]);
  auth.length = 0;
  await controller.confirm({}, id);
  assert.equal(confirms, 1);
  assert.ok(gets >= 2);
  assert.deepEqual(auth, ["checkout.manage", "subscription.manage"]);
});
test("cancel authorizes the central attempt owner and management before transport", async () => {
  const { service, auth } = fixture();
  const id = randomUUID();
  service.client.attempts.get = async (attempt, buyer) => {
    assert.equal(attempt, id);
    assert.deepEqual(buyer, {
      organizationId: c.organizationId,
      userId: c.subjectId,
    });
    return { attemptId: id, operation: "change_plan" };
  };
  let cancelled = 0;
  service.client.attempts.cancel = async (attempt, buyer) => {
    assert.equal(attempt, id);
    assert.deepEqual(buyer, {
      organizationId: c.organizationId,
      userId: c.subjectId,
    });
    cancelled++;
    return { cancelled: true };
  };
  const controller = new PaymentsController(service);
  assert.deepEqual(await controller.cancelAttempt({}, id), { cancelled: true });
  assert.equal(cancelled, 1);
  assert.deepEqual(auth, ["checkout.manage", "subscription.manage"]);
  service.client.attempts.get = async () => {
    throw new Error("Different owner");
  };
  await assert.rejects(controller.cancelAttempt({}, id), /Different owner/);
  assert.equal(cancelled, 1);
});
test("retry delegates frozen intent without deriving a new subscription", async () => {
  const { service } = fixture();
  const id = randomUUID();
  service.client.subscriptions.current = async () =>
    assert.fail("must not select a new source");
  service.client.attempts.retry = async (attempt, buyer) => ({
    attemptId: attempt,
    status: "ready",
    statusFresh: true,
    owner: buyer.userId,
  });
  const result = await service.retryAttempt(c, id);
  assert.equal(result.attemptId, id);
  assert.equal(result.owner, c.subjectId);
});
test("live license needs no management snapshot or optional sink", async () => {
  const { service } = fixture();
  let calls = 0;
  service.client.snapshots.current = async () =>
    assert.fail("license.read must not require subscription.manage");
  service.options.onSnapshot = async () =>
    assert.fail("observer must not affect payment/remote license");
  service.client.licenses.resolve = async (org) => {
    assert.equal(org, c.organizationId);
    calls++;
    return {
      active: true,
      subscriptionId: randomUUID(),
      planCode: "pro",
      licenseStatus: "active",
      validUntil: new Date(Date.now() + 60000).toISOString(),
      features: { reports: true },
      entitlements: { maxUsers: 5 },
      billing: { nextBillingTime: "2026-12-01T00:00:00Z" },
    };
  };
  const license = await service.getLicense(c);
  assert.equal(license.active, true);
  assert.equal(license.source, "billing");
  assert.equal(license.entitlements.maxUsers, 5);
  assert.ok(license.confirmedAt);
  assert.equal(calls, 1);
});

test("cross-device recovery uses only the matching central buyer receipt and preserves null payment continuation", async () => {
  const { service } = fixture();
  const subscriptionId = randomUUID(),
    checkoutId = randomUUID(),
    attemptId = randomUUID();
  const source = {
    id: subscriptionId,
    organizationId: c.organizationId,
    productCode: "atlas",
    pendingPlanChange: {
      attemptId,
      checkoutId,
      newSubscriptionId: subscriptionId,
      targetPlanCode: "pro",
      targetPlanPriceCode: "monthly",
      state: "awaiting_approval",
      effectiveAt: "2026-12-01T00:00:00Z",
      action: "approve_subscription",
      checkoutUrl: null,
    },
  };
  const row = {
    attemptId,
    operation: "change_plan",
    status: "ready",
    statusFresh: true,
    checkoutId,
    subscriptionId,
    planCode: "pro",
    planPriceCode: "monthly",
    checkoutUrl: "https://www.sandbox.paypal.com/revision",
    planChange: {
      state: "awaiting_approval",
      effectiveAt: source.pendingPlanChange.effectiveAt,
      action: "approve_subscription",
      checkoutUrl: "https://www.sandbox.paypal.com/revision",
    },
  };
  service.client.subscriptions.current = async (org) => {
    assert.equal(org, c.organizationId);
    return source;
  };
  service.client.attempts.get = async (id, buyer) => {
    assert.equal(id, attemptId);
    assert.deepEqual(buyer, {
      organizationId: c.organizationId,
      userId: c.subjectId,
    });
    return row;
  };
  for (const operation of ["create", "retry", "confirm", "cancel"])
    service.client.attempts[operation] = async () =>
      assert.fail("A subscription GET cannot mutate payment attempts");
  let recovered = await service.getSubscription(c);
  assert.equal(recovered.pendingPlanChange.attemptId, attemptId);
  assert.equal(
    recovered.pendingPlanChange.checkoutUrl,
    row.planChange.checkoutUrl,
  );
  source.pendingPlanChange.action = "approve_payment";
  row.planChange.action = "approve_payment";
  row.planChange.checkoutUrl = null;
  recovered = await service.getSubscription(c);
  assert.equal(recovered.pendingPlanChange.attemptId, attemptId);
  assert.equal(recovered.pendingPlanChange.action, "approve_payment");
  assert.equal(recovered.pendingPlanChange.checkoutUrl, null);
  row.planChange.cancellationRequested = true;
  row.planChange.action = "approve_subscription";
  row.planChange.checkoutUrl = "https://www.paypal.com/restore-original-plan";
  recovered = await service.getSubscription(c);
  assert.equal(recovered.pendingPlanChange.cancellationRequested, true);
  assert.equal(recovered.pendingPlanChange.action, "approve_subscription");
  assert.equal(
    recovered.pendingPlanChange.checkoutUrl,
    row.planChange.checkoutUrl,
  );
  delete row.planChange.cancellationRequested;
  row.statusFresh = false;
  row.planChange.action = "approve_subscription";
  row.planChange.checkoutUrl = row.checkoutUrl;
  assert.equal(
    (await service.getSubscription(c)).pendingPlanChange.checkoutUrl,
    null,
    "Never resurrect the old agreement URL from a stale attempt",
  );
  source.pendingPlanChange.state = "scheduled";
  source.pendingPlanChange.action = "none";
  assert.equal(
    (await service.getSubscription(c)).pendingPlanChange.checkoutUrl,
    null,
  );
  const { PaymentsError } = require("../../dist");
  service.client.attempts.get = async () => {
    throw new PaymentsError("http", 404);
  };
  recovered = await service.getSubscription(c);
  assert.equal(recovered.id, subscriptionId);
  assert.equal(recovered.pendingPlanChange.attemptId, undefined);
  assert.equal(recovered.pendingPlanChange.checkoutUrl, null);
  service.client.attempts.get = async () => ({
    ...row,
    checkoutId: randomUUID(),
  });
  assert.equal(
    (await service.getSubscription(c)).pendingPlanChange.attemptId,
    undefined,
  );
});

test("integration readiness verifies remote compatibility before catalog access", async () => {
  const { service } = fixture();
  const calls = [];
  service.client.verifyCompatibility = async () => {
    calls.push("compatibility");
    return { contract: "billing.integrations.v1", billingVersion: "1.0.1" };
  };
  service.client.catalog.listPlans = async () => {
    calls.push("catalog");
    return [];
  };
  const status = await service.integrationStatus();
  assert.deepEqual(calls, ["compatibility", "catalog"]);
  assert.equal(status.ready, true);
  assert.equal(status.compatibility.billingVersion, "1.0.1");

  calls.length = 0;
  const { PaymentsError } = require("../../dist");
  service.client.verifyCompatibility = async () => {
    throw new PaymentsError("compatibility", 503);
  };
  await assert.rejects(
    service.integrationStatus(),
    (error) => error.getStatus() === 503,
  );
  assert.deepEqual(calls, []);
});


test("initial checkout discard delegates only the buyer-bound attempt, never subscription cancellation", async () => {
  const { service } = fixture();
  const id = randomUUID();
  service.client.attempts.get = async () => ({ attemptId: id, operation: "checkout" });
  service.client.subscriptions.cancel = async () => assert.fail("must preserve the current plan");
  service.client.attempts.cancel = async (attempt, buyer) => {
    assert.equal(attempt, id);
    assert.deepEqual(buyer, { organizationId: c.organizationId, userId: c.subjectId });
    return { cancelled: true };
  };
  assert.deepEqual(await new PaymentsController(service).cancelAttempt({}, id), { cancelled: true });
});

for (const alreadyRequested of [false, true]) {
  test(`scheduled downgrade cancellation remains recoverable through the buyer-bound attempt (${alreadyRequested})`, async () => {
    const { service } = fixture();
    const id = randomUUID();
    const restoreUrl = "https://www.sandbox.paypal.com/restore/current-plan";
    const change = { state: "scheduled", cancellationRequested: alreadyRequested, attemptId: id, checkoutId: id,
      targetPlanCode: "professional", targetPlanPriceCode: "monthly", effectiveAt: "2026-11-26T10:00:00Z",
      action: alreadyRequested ? "approve_subscription" : "none", checkoutUrl: null };
    service.client.subscriptions.current = async () => ({ id, organizationId: c.organizationId, productCode: "atlas",
      status: "active", planCode: "despacho", planPriceCode: "monthly", pendingPlanChange: change });
    service.client.attempts.get = async (attemptId, buyer) => {
      assert.equal(attemptId, id); assert.equal(buyer.userId, c.subjectId);
      return { attemptId: id, checkoutId: id, subscriptionId: id, operation: "change_plan", statusFresh: true,
        planCode: "professional", planPriceCode: "monthly", checkoutUrl: restoreUrl,
        planChange: { state: "scheduled", cancellationRequested: true, effectiveAt: change.effectiveAt,
          action: "approve_subscription", checkoutUrl: restoreUrl } };
    };
    const current = await service.getSubscription(c);
    assert.equal(current.planCode, "despacho");
    assert.equal(current.pendingPlanChange.cancellationRequested, true);
    assert.equal(current.pendingPlanChange.checkoutUrl, restoreUrl);
  });
}

test("resume renewal derives the original contract, buyer and URLs and rejects browser pricing and stale sources before mutation", async () => {
  const { service, auth } = fixture();
  const sourceId = randomUUID(), key = randomUUID();
  let sent;
  service.getSubscription = async () => ({ id: sourceId, planCode: "business", planPriceCode: "monthly" });
  service.options.returnUrls = async (context, id) => {
    assert.deepEqual(context, c); assert.equal(id, key);
    return { successUrl: `https://product.test/success?attemptId=${key}`, cancelUrl: "https://product.test/cancel" };
  };
  service.client.attempts.create = async input => { sent = input; return { attemptId: key, status: "pending", statusFresh: false, operation: "resume_renewal" }; };
  const controller = new PaymentsController(service);
  const response = { status: () => {}, setHeader: () => {} };
  const body = { idempotencyKey: key, expectedSubscriptionId: sourceId };
  await controller.resumeRenewal({}, body, response);
  assert.deepEqual(auth, ["subscription.manage"]);
  assert.equal(sent.operation, "resume_renewal");
  assert.equal(sent.organizationId, c.organizationId); assert.equal(sent.userId, c.subjectId);
  assert.equal(sent.planCode, "business"); assert.equal(sent.planPriceCode, "monthly");
  assert.equal(sent.expectedSubscriptionId, sourceId); assert.equal(sent.idempotencyKey, key);
  assert.equal(Object.hasOwn(sent, "legalAcceptanceId"), false);
  sent = undefined;
  await assert.rejects(controller.resumeRenewal({}, { ...body, planCode: "free" }, response), e => e.getStatus() === 400);
  await assert.rejects(controller.resumeRenewal({}, { ...body, expectedSubscriptionId: randomUUID() }, response), e => e.getStatus() === 409);
  assert.equal(sent, undefined);
});
test("renewal attempt reads and retries require management authorization and never confirm on GET", async () => {
  const { service, auth } = fixture(); const id = randomUUID();
  let confirms = 0;
  service.client.attempts.get = async () => ({ attemptId: id, operation: "resume_renewal", status: "ready", statusFresh: true });
  service.client.attempts.confirm = async () => { confirms++; };
  await new PaymentsController(service).get({}, id);
  assert.deepEqual(auth, ["checkout.manage", "subscription.manage"]);
  assert.equal(confirms, 0);
});
for (const variant of ["valid", "stale", "other-source", "other-new", "other-plan", "other-price", "other-operation", "other-boundary", "other-amount", "scheduled", "already-scheduled", "scheduled-cancelled"]) {
  test(`pending renewal recovery uses only bound fresh canonical approval (${variant})`, async () => {
    const { service } = fixture(); const sourceId = randomUUID(), nextId = randomUUID(), attemptId = randomUUID();
    const quote = { state: "awaiting_approval", sourceSubscriptionId: sourceId, effectiveAt: "2026-11-26T10:00:00Z", amountDueNow: "0.00", recurringAmount: "999.00", currency: "MXN" };
    const oldUrl = "https://www.sandbox.paypal.com/approve/old", currentUrl = "https://www.sandbox.paypal.com/approve/current";
    service.client.subscriptions.current = async () => ({ id: sourceId, planCode: "business", planPriceCode: "monthly", pendingPlanChange: null,
      pendingRenewal: { ...quote, ...(["already-scheduled", "scheduled-cancelled"].includes(variant) ? { state: "scheduled" } : {}), attemptId, subscriptionId: nextId, checkoutUrl: oldUrl } });
    const checked = { ...quote,
      ...(variant === "other-source" ? { sourceSubscriptionId: randomUUID() } : {}),
      ...(variant === "other-boundary" ? { effectiveAt: "2026-12-26T10:00:00Z" } : {}),
      ...(variant === "other-amount" ? { recurringAmount: "1999.00" } : {}),
      ...(variant === "scheduled" ? { state: "scheduled" } : {}),
      ...(variant === "scheduled-cancelled" ? { state: "failed" } : {}) };
    service.client.attempts.get = async (_, buyer) => {
      assert.equal(buyer.userId, c.subjectId);
      return { attemptId, operation: variant === "other-operation" ? "checkout" : "resume_renewal", subscriptionId: variant === "other-new" ? randomUUID() : nextId,
        planCode: variant === "other-plan" ? "other" : "business", planPriceCode: variant === "other-price" ? "yearly" : "monthly",
        statusFresh: variant !== "stale", renewalResume: checked, checkoutUrl: currentUrl };
    };
    const result = await service.getSubscription(c);
    assert.equal(result.pendingRenewal.checkoutUrl, variant === "valid" ? currentUrl : null);
    if (variant !== "valid" && variant !== "stale" && variant !== "scheduled" && variant !== "already-scheduled" && variant !== "scheduled-cancelled") assert.equal(result.pendingRenewal.attemptId, undefined);
    assert.notEqual(result.pendingRenewal.checkoutUrl, oldUrl);
    if (variant === "scheduled-cancelled") assert.equal(result.pendingRenewal.state, "failed");
  });
}

test("future renewal plan endpoint derives identity and binds both existing subscriptions, rejecting money and date overrides", async () => {
  const { service, auth } = fixture(); const sourceId = randomUUID(), nextId = randomUUID(), key = randomUUID(); let sent;
  service.getSubscription = async () => ({ id: sourceId, pendingRenewal: { subscriptionId: nextId } });
  service.options.returnUrls = async (context, id) => { assert.equal(context.subjectId, c.subjectId); assert.equal(id, key); return { successUrl: `https://product.test/success?attemptId=${key}`, cancelUrl: "https://product.test/cancel" }; };
  service.client.attempts.create = async input => { sent = input; return { attemptId: key, status: "pending", statusFresh: false, operation: "change_renewal_plan" }; };
  const dto = { idempotencyKey: key, expectedSubscriptionId: sourceId, expectedRenewalSubscriptionId: nextId, targetPlanCode: "professional", targetPlanPriceCode: "monthly" };
  const controller = new PaymentsController(service), response = { status() {}, setHeader() {} };
  await controller.changeRenewalPlan({}, dto, response);
  assert.deepEqual(auth, ["subscription.manage"]);
  assert.equal(sent.organizationId, c.organizationId); assert.equal(sent.userId, c.subjectId);
  assert.equal(sent.operation, "change_renewal_plan"); assert.equal(sent.planCode, dto.targetPlanCode);
  assert.equal(sent.expectedSubscriptionId, sourceId); assert.equal(sent.expectedRenewalSubscriptionId, nextId);
  sent = undefined;
  for (const altered of [{ amountDueNow: "0.00" }, { effectiveAt: "2030-01-01" }, { userId: c.subjectId }])
    await assert.rejects(controller.changeRenewalPlan({}, { ...dto, ...altered }, response), e => e.getStatus() === 400);
  await assert.rejects(controller.changeRenewalPlan({}, { ...dto, expectedSubscriptionId: randomUUID() }, response), e => e.getStatus() === 409);
  await assert.rejects(controller.changeRenewalPlan({}, { ...dto, expectedRenewalSubscriptionId: randomUUID() }, response), e => e.getStatus() === 409);
  assert.equal(sent, undefined);
  service.client.attempts.get = async () => ({ operation: "change_renewal_plan" }); auth.length = 0;
  await controller.get({}, key);
  assert.deepEqual(auth, ["checkout.manage", "subscription.manage"]);
});
for (const variant of ["valid", "stale", "other-operation", "other-source", "other-candidate", "other-checkout", "other-target", "other-price", "scheduled", "restoring", "restore-without-url", "cancelled", "old-approval", "other-owner"]) {
  test(`future renewal revision recovery binds exact canonical intent (${variant})`, async () => {
    const { service } = fixture(); const sourceId = randomUUID(), candidateId = randomUUID(), attemptId = randomUUID(), checkoutId = randomUUID();
    const approval = "https://www.sandbox.paypal.com/approve/future-new", restore = "https://www.sandbox.paypal.com/restore/future-original";
    const quote = { state: "awaiting_approval", sourceSubscriptionId: sourceId, renewalSubscriptionId: candidateId, targetPlanCode: "professional", targetPlanPriceCode: "monthly",
      effectiveAt: "2026-11-26T10:00:00Z", amountDueNow: "0.00", recurringAmount: "499.00", currency: "MXN", cancellationRequested: false, action: "approve_subscription", checkoutUrl: approval };
    const restoring = ["restoring", "restore-without-url", "old-approval", "cancelled"].includes(variant);
    const sourceRevision = { ...quote, state: ["scheduled", "restoring", "restore-without-url", "old-approval", "cancelled"].includes(variant) ? "scheduled" : "awaiting_approval",
      cancellationRequested: restoring, attemptId, checkoutId, checkoutUrl: "https://www.sandbox.paypal.com/old" };
    service.client.subscriptions.current = async () => ({ id: sourceId, planCode: "business", planPriceCode: "monthly", pendingPlanChange: null,
      pendingRenewal: { state: "scheduled", subscriptionId: candidateId }, pendingRenewalPlanChange: sourceRevision });
    const checked = { ...quote, ...(variant === "other-source" ? { sourceSubscriptionId: randomUUID() } : {}),
      ...(variant === "other-candidate" ? { renewalSubscriptionId: randomUUID() } : {}),
      ...(variant === "other-target" ? { targetPlanCode: "other" } : {}),
      ...(variant === "other-price" ? { targetPlanPriceCode: "yearly" } : {}),
      ...(variant === "scheduled" ? { state: "scheduled", action: "none", checkoutUrl: null } : {}),
      ...(restoring && variant !== "old-approval" ? { state: variant === "cancelled" ? "failed" : "scheduled", cancellationRequested: true, checkoutUrl: variant === "restore-without-url" ? null : restore } : {}) };
    service.client.attempts.get = async () => {
      if (variant === "other-owner") { const { PaymentsError } = require("../../dist"); throw new PaymentsError("http", 404); }
      return { operation: variant === "other-operation" ? "resume_renewal" : "change_renewal_plan", checkoutId: variant === "other-checkout" ? randomUUID() : checkoutId,
        subscriptionId: candidateId, planCode: "professional", planPriceCode: "monthly", statusFresh: variant !== "stale", renewalPlanChange: checked,
        checkoutUrl: checked.checkoutUrl };
    };
    const result = await service.getSubscription(c), actual = result.pendingRenewalPlanChange;
    assert.equal(actual.checkoutUrl, variant === "valid" ? approval : variant === "restoring" ? restore : null);
    assert.notEqual(actual.checkoutUrl, sourceRevision.checkoutUrl);
    if (variant === "cancelled") assert.equal(actual.state, "failed");
    if (variant === "other-owner" || variant.startsWith("other-") && variant !== "other-operation") assert.equal(actual.attemptId, undefined);
  });
}

for (const variant of ["restoration", "stale", "uncancelled", "effective"]) {
  test(`late approval reopens only a fresh bound cancellation restoration (${variant})`, async () => {
    const { service } = fixture(); const sourceId = randomUUID(), candidateId = randomUUID(), attemptId = randomUUID(), checkoutId = randomUUID();
    const quote = { state: variant === "effective" ? "effective" : "failed", sourceSubscriptionId: sourceId, renewalSubscriptionId: candidateId,
      targetPlanCode: "professional", targetPlanPriceCode: "monthly", effectiveAt: "2026-11-26T10:00:00Z",
      amountDueNow: "0.00", recurringAmount: "499.00", currency: "MXN", cancellationRequested: variant !== "uncancelled", action: "none", checkoutUrl: null };
    service.client.subscriptions.current = async () => ({ id: sourceId, planCode: "business", planPriceCode: "monthly", pendingPlanChange: null,
      pendingRenewal: { subscriptionId: candidateId, state: "scheduled" },
      pendingRenewalPlanChange: { ...quote, attemptId, checkoutId } });
    const restoreUrl = "https://www.sandbox.paypal.com/restore/original-renewal";
    service.client.attempts.get = async () => ({ operation: "change_renewal_plan", status: "ready", statusFresh: variant !== "stale",
      checkoutId, subscriptionId: candidateId, planCode: "professional", planPriceCode: "monthly", checkoutUrl: restoreUrl,
      renewalPlanChange: { ...quote, state: "awaiting_approval", cancellationRequested: true, action: "approve_subscription", checkoutUrl: restoreUrl } });
    const current = await service.getSubscription(c);
    assert.equal(current.pendingRenewalPlanChange.state, variant === "restoration" ? "awaiting_approval" : quote.state);
    assert.equal(current.pendingRenewalPlanChange.checkoutUrl, variant === "restoration" ? restoreUrl : null);
  });
}

for (const variant of ["authorized-history", "different-checkout", "other-buyer"]) {
  test(`discarding a newer intent retains controls only for the bound last authorized renewal change (${variant})`, async () => {
    const { service, auth } = fixture();
    const sourceId = randomUUID(), candidateId = randomUUID(), resumeAttemptId = randomUUID();
    const authorizedAttemptId = randomUUID(), authorizedCheckoutId = randomUUID(), discardedAttemptId = randomUUID();
    const effectiveAt = "2026-11-26T10:00:00.000Z";
    const common = { state: "scheduled", sourceSubscriptionId: sourceId, effectiveAt,
      amountDueNow: "0.00", recurringAmount: "499.00", currency: "MXN" };
    const authorized = { ...common, renewalSubscriptionId: candidateId, targetPlanCode: "professional", targetPlanPriceCode: "monthly",
      cancellationRequested: false, action: "none", checkoutUrl: null };
    service.client.subscriptions.current = async () => ({ id: sourceId, planCode: "business", planPriceCode: "monthly", pendingPlanChange: null,
      pendingRenewal: { ...common, subscriptionId: candidateId, attemptId: resumeAttemptId, planCode: "professional", planPriceCode: "monthly" },
      pendingRenewalPlanChange: { ...authorized, attemptId: authorizedAttemptId, checkoutId: authorizedCheckoutId } });
    const reads = [], cancellations = [];
    service.client.attempts.get = async (attemptId, buyer) => {
      reads.push(attemptId);
      assert.deepEqual(buyer, { organizationId: c.organizationId, userId: c.subjectId });
      if (attemptId === resumeAttemptId) return { attemptId, operation: "resume_renewal", subscriptionId: candidateId, planCode: "business", planPriceCode: "monthly", statusFresh: true,
        renewalResume: { ...common, planCode: "professional", planPriceCode: "monthly" } };
      assert.equal(attemptId, authorizedAttemptId);
      if (variant === "other-buyer") { const { PaymentsError } = require("../../dist"); throw new PaymentsError("http", 404); }
      return { attemptId, operation: "change_renewal_plan", checkoutId: variant === "different-checkout" ? randomUUID() : authorizedCheckoutId,
        subscriptionId: candidateId, planCode: "professional", planPriceCode: "monthly", statusFresh: true, renewalPlanChange: authorized };
    };
    service.client.attempts.cancel = async (attemptId, buyer) => {
      cancellations.push(attemptId); assert.equal(buyer.userId, c.subjectId);
      return { cancelled: false, approvalUrl: "https://www.sandbox.paypal.com/restore/original-business" };
    };
    const current = await service.getSubscription(c);
    assert.equal(current.planCode, "business");
    assert.equal(current.pendingRenewal.planCode, "professional");
    assert.equal(current.pendingRenewal.attemptId, resumeAttemptId);
    assert.equal(current.pendingRenewalPlanChange.attemptId, variant === "authorized-history" ? authorizedAttemptId : undefined);
    assert.equal(current.pendingRenewalPlanChange.checkoutUrl, null);
    assert.equal(reads.includes(discardedAttemptId), false);
    assert.deepEqual(cancellations, []);
    if (variant === "authorized-history") {
      await new PaymentsController(service).cancelAttempt({}, current.pendingRenewalPlanChange.attemptId);
      assert.deepEqual(cancellations, [authorizedAttemptId]);
      assert.deepEqual(auth, ["checkout.manage", "subscription.manage"]);
      assert.equal(cancellations.includes(discardedAttemptId), false);
    }
  });
}
