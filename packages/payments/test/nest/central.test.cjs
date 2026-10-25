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
