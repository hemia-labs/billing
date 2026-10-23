const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
require("reflect-metadata");
const { Module } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { DataSource } = require("typeorm");
const {
  PaymentsModule,
  PaymentsService,
  PaymentsSchema1792886400000,
} = require("../../../packages/payments/dist/nestjs");

// A dedicated ephemeral PostgreSQL database is mandatory; never consume DATABASE_URL.
test("PostgreSQL preserves ready receipts while canonical plan changes stop advertising old approval links", async (t) => {
  const port = Number(process.env.PAYMENTS_RECEIPT_PG_PORT);
  assert.ok(
    Number.isInteger(port) && port >= 1024 && port <= 65535,
    "Set PAYMENTS_RECEIPT_PG_PORT for the disposable test database",
  );
  const db = new DataSource({
    type: "postgres",
    host: "127.0.0.1",
    port,
    username: "postgres",
    password: "isolated-receipt-only",
    database: "payments_receipt_test",
    synchronize: false,
    migrationsRun: false,
  });
  await db.initialize();
  let app;
  t.after(async () => {
    if (app) await app.close();
    await db.destroy();
  });
  assert.equal(
    (await db.query("SELECT current_database() AS name"))[0].name,
    "payments_receipt_test",
  );
  const runner = db.createQueryRunner();
  try {
    await new PaymentsSchema1792886400000().up(runner);
  } finally {
    await runner.release();
  }
  const actor = { organizationId: randomUUID(), subjectId: randomUUID() };
  const otherUser = { ...actor, subjectId: randomUUID() };
  const otherOrganization = {
    organizationId: randomUUID(),
    subjectId: randomUUID(),
  };
  const subscriptionId = randomUUID();
  const revisionUrl = "https://www.sandbox.paypal.com/approve-subscription";
  const paymentUrl = "https://www.sandbox.paypal.com/approve-proration";
  const quote = {
    kind: "upgrade",
    amountDueNow: "150.00",
    currency: "MXN",
    recurringAmount: "600.00",
    effectiveAt: "2026-10-23T12:00:00.000Z",
    nextBillingAt: "2026-11-07T12:00:00.000Z",
  };
  let canonical;
  let purchaseCalls = 0,
    verifyCalls = 0,
    statusCalls = 0;
  const source = () => ({
    id: subscriptionId,
    organizationId: actor.organizationId,
    productCode: "receipt-test",
    planCode: "basic",
    planPriceCode: "monthly",
    status: "active",
    cancelAtPeriodEnd: false,
    cancellation: null,
    pendingPlanChange: null,
  });
  const options = {
    dataSource: db,
    connection: {
      issuer: "https://identity.test",
      tokenUrl: "https://identity.test/oauth/token",
      clientId: "receipt-consumer",
      baseUrl: "https://billing.test/api/v1",
      audience: "billing-api",
      productCode: "receipt-test",
      successUrl: "https://product.test/success",
      cancelUrl: "https://product.test/cancel",
    },
    clientSecret: "fixture-only-secret",
    authorize: async (request) =>
      request.headers["x-test-actor"] === "other-user"
        ? otherUser
        : request.headers["x-test-actor"] === "other-org"
          ? otherOrganization
          : actor,
  };
  async function start() {
    class HostModule {}
    Module({
      imports: [PaymentsModule.forRootAsync({ useFactory: () => options })],
    })(HostModule);
    app = await NestFactory.create(HostModule, { logger: false });
    const service = app.get(PaymentsService);
    service.client.catalog.listPlans = async () => [
      { code: "pro", prices: [{ code: "monthly" }] },
    ];
    service.client.subscriptions.current = async () => source();
    service.client.subscriptions.changePlan = async () => {
      purchaseCalls++;
      canonical = {
        checkoutId: randomUUID(),
        subscriptionId,
        checkoutStatus: "created",
        subscriptionStatus: "pending",
        provider: "paypal",
        planChange: {
          ...quote,
          state: "awaiting_approval",
          action: "approve_subscription",
          checkoutUrl: revisionUrl,
        },
      };
      return {
        subscription: source(),
        checkoutId: canonical.checkoutId,
        newSubscriptionId: subscriptionId,
        checkoutUrl: revisionUrl,
        targetPlanCode: "pro",
        state: canonical.planChange.state,
        effectiveAt: quote.effectiveAt,
        planChange: canonical.planChange,
      };
    };
    service.client.checkout.status = async () => {
      statusCalls++;
      return canonical;
    };
    service.client.checkout.verify = async () => {
      verifyCalls++;
      return canonical;
    };
    await app.listen(0, "127.0.0.1");
    return service;
  }
  let service = await start();
  async function api(path, method = "GET", body, user = "actor") {
    const response = await fetch(
      `http://127.0.0.1:${app.getHttpServer().address().port}/payments${path}`,
      {
        method,
        headers: { "x-test-actor": user, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return { status: response.status, body: await response.json() };
  }
  async function create() {
    const result = await api("/subscription/change-plan", "POST", {
      idempotencyKey: randomUUID(),
      expectedSubscriptionId: subscriptionId,
      planCode: "pro",
      planPriceCode: "monthly",
      expectedAmountDueNow: quote.amountDueNow,
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.checkoutUrl, revisionUrl);
    return result.body;
  }
  async function saved(id) {
    const [row] = await db.query(
      "SELECT status,checkout_url,request_payload FROM public.payments_checkout_attempts WHERE id=$1",
      [id],
    );
    assert.equal(row.status, "ready");
    assert.ok(
      row.checkout_url,
      "The original migration requires a non-null receipt URL",
    );
    return row;
  }
  let attempt;
  await t.test(
    "GET without a payment URL keeps the SQL receipt and hides the old subscription link",
    async () => {
      attempt = await create();
      canonical.planChange = {
        ...quote,
        state: "awaiting_approval",
        action: "approve_payment",
        checkoutUrl: null,
      };
      // Read through the actual service/storage path first: unpatched 0.5.0 fails with PostgreSQL code 23514.
      const read = await service.getAttempt(actor, attempt.attemptId);
      assert.equal(read.checkoutUrl, undefined);
      assert.equal(read.planChange.checkoutUrl, null);
      const response = await api("/checkout-attempts/" + attempt.attemptId);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.statusFresh, true);
      assert.equal(response.body.checkoutUrl, undefined);
      assert.equal((await saved(attempt.attemptId)).checkout_url, revisionUrl);
      assert.equal(verifyCalls, 0, "GET must never confirm a payment");
    },
  );
  await t.test(
    "POST confirmation with scheduled/effective changes keeps non-null receipts without stale links",
    async () => {
      for (const state of ["scheduled", "effective"]) {
        const row = await create();
        canonical = {
          ...canonical,
          subscriptionStatus: state === "effective" ? "active" : "pending",
          planChange: {
            ...quote,
            kind: state === "scheduled" ? "downgrade" : "upgrade",
            state,
            action: "none",
            checkoutUrl: null,
          },
        };
        const result = await api(
          `/checkout-attempts/${row.attemptId}/confirm`,
          "POST",
        );
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.planChange.state, state);
        assert.equal(result.body.checkoutUrl, undefined);
        assert.equal((await saved(row.attemptId)).checkout_url, revisionUrl);
        const polled = await api(`/checkout-attempts/${row.attemptId}`);
        assert.equal(polled.status, 200);
        assert.equal(polled.body.planChange.state, state);
        assert.equal(polled.body.checkoutUrl, undefined);
        const cached = await api(
          `/checkout-attempts/${row.attemptId}/retry`,
          "POST",
        );
        assert.equal(cached.status, 200);
        assert.equal(cached.body.checkoutUrl, undefined);
      }
    },
  );
  await t.test(
    "a real payment URL propagates; no-link confirmation survives application restart and cached retry",
    async () => {
      attempt = await create();
      canonical.planChange = {
        ...quote,
        state: "awaiting_approval",
        action: "approve_payment",
        checkoutUrl: paymentUrl,
      };
      const pay = await api(
        `/checkout-attempts/${attempt.attemptId}/confirm`,
        "POST",
      );
      assert.equal(pay.status, 200);
      assert.equal(pay.body.checkoutUrl, paymentUrl);
      assert.equal((await saved(attempt.attemptId)).checkout_url, paymentUrl);
      // Force sub-millisecond precision so a Date-based CAS token fails deterministically.
      await db.query(
        "UPDATE public.payments_checkout_attempts SET status_checked_at='2026-10-23 12:00:00.123456+00'::timestamptz WHERE id=$1",
        [attempt.attemptId],
      );
      canonical.planChange.checkoutUrl = null;
      const noLink = await api(
        `/checkout-attempts/${attempt.attemptId}/confirm`,
        "POST",
      );
      assert.equal(noLink.status, 200);
      assert.equal(noLink.body.checkoutUrl, undefined);
      assert.equal((await saved(attempt.attemptId)).checkout_url, paymentUrl);
      const before = { purchaseCalls, verifyCalls };
      await app.close();
      app = undefined;
      service = await start();
      const retry = await api(
        `/checkout-attempts/${attempt.attemptId}/retry`,
        "POST",
      );
      assert.equal(retry.status, 200);
      assert.equal(retry.body.checkoutUrl, undefined);
      assert.equal(retry.body.planChange.checkoutUrl, null);
      assert.deepEqual(
        { purchaseCalls, verifyCalls },
        before,
        "A cached retry must not repeat a purchase or confirmation",
      );
    },
  );
  await t.test(
    "subscription summaries and unavailable status never revive the durable stale receipt URL",
    async () => {
      service.client.subscriptions.current = async () => ({
        ...source(),
        pendingPlanChange: {
          ...canonical.planChange,
          checkoutId: canonical.checkoutId,
          newSubscriptionId: subscriptionId,
          targetPlanCode: "pro",
          targetPlanPriceCode: "monthly",
        },
      });
      const summary = await api("/subscription");
      assert.equal(summary.status, 200);
      assert.equal(summary.body.pendingPlanChange.attemptId, attempt.attemptId);
      assert.equal(summary.body.pendingPlanChange.checkoutUrl, null);
      service.client.checkout.status = async () => {
        throw new Error("Billing temporarily unavailable");
      };
      const stale = await api(`/checkout-attempts/${attempt.attemptId}`);
      assert.equal(stale.status, 200);
      assert.equal(stale.body.statusFresh, false);
      assert.equal(stale.body.checkoutUrl, undefined);
      assert.equal(stale.body.planChange.checkoutUrl, null);
      service.client.checkout.status = async () => {
        statusCalls++;
        return canonical;
      };
    },
  );
  await t.test(
    "a delayed older GET cannot overwrite a newer confirmed plan change",
    async () => {
      const row = await create();
      const old = structuredClone(canonical);
      let started, release;
      const waiting = new Promise((resolve) => {
        started = resolve;
      });
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      service.client.checkout.status = async () => {
        statusCalls++;
        started();
        await gate;
        return old;
      };
      const delayed = api(`/checkout-attempts/${row.attemptId}`);
      await waiting;
      canonical = {
        ...canonical,
        subscriptionStatus: "active",
        planChange: {
          ...quote,
          state: "effective",
          action: "none",
          checkoutUrl: null,
        },
      };
      try {
        const confirmed = await api(
          `/checkout-attempts/${row.attemptId}/confirm`,
          "POST",
        );
        assert.equal(confirmed.status, 200);
        assert.equal(confirmed.body.planChange.state, "effective");
      } finally {
        release();
      }
      const latest = await delayed;
      assert.equal(latest.status, 200);
      assert.equal(latest.body.planChange.state, "effective");
      assert.equal(latest.body.checkoutUrl, undefined);
      assert.equal(
        (await saved(row.attemptId)).request_payload.planChange.state,
        "effective",
      );
      service.client.checkout.status = async () => {
        statusCalls++;
        return canonical;
      };
    },
  );
  await t.test(
    "other organizations and actors cannot read, confirm or retry the saved change",
    async () => {
      const before = { purchaseCalls, verifyCalls, statusCalls };
      for (const user of ["other-user", "other-org"]) {
        for (const [suffix, method] of [
          ["", "GET"],
          ["/confirm", "POST"],
          ["/retry", "POST"],
        ]) {
          const result = await api(
            `/checkout-attempts/${attempt.attemptId}${suffix}`,
            method,
            undefined,
            user,
          );
          assert.equal(result.status, 404);
        }
      }
      assert.deepEqual({ purchaseCalls, verifyCalls, statusCalls }, before);
    },
  );
});
