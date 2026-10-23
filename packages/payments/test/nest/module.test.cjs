const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
require("reflect-metadata");
const { PaymentsServiceTokens } = require("../../dist/nestjs/service-tokens");
const { PaymentsStorage } = require("../../dist/nestjs/storage");
const {
  PaymentsModule,
  SERVICE_AUTHENTICATED_METADATA,
} = require("../../dist/nestjs");
const { attemptInput, webhookInput } = require("../../dist/nestjs/validation");
const { PAYMENTS_OPTIONS } = require("../../dist/nestjs/types");
const org = crypto.randomUUID(),
  subject = crypto.randomUUID();
const connection = {
  issuer: "https://identity.test",
  tokenUrl: "https://identity.test/oauth/token",
  baseUrl: "https://billing.test/api/v1",
  audience: "billing-api",
  clientId: "atlas",
  productCode: "atlas",
};
const receiver = {
  audience: "atlas-api",
  jwksUrl: "https://identity.test/.well-known/jwks.json",
  introspectionUrl: "https://identity.test/oauth/introspect",
  billingClientId: "billing",
  consoleClientId: "console",
};
const options = { connection, clientSecret: "do-not-log", receiver };
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const key = {
  ...publicKey.export({ format: "jwk" }),
  kid: "one",
  alg: "RS256",
  use: "sig",
};
function jwt(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    iss: connection.issuer,
    aud: receiver.audience,
    client_id: "billing",
    sub: "billing",
    grant_type: "client_credentials",
    iat: now - 1,
    exp: now + 120,
    scope: "billing.webhooks.deliver",
    ...extra,
  };
  const head = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "at+jwt", kid: "one" }),
  ).toString("base64url");
  const data =
    head + "." + Buffer.from(JSON.stringify(body)).toString("base64url");
  return (
    data +
    "." +
    crypto
      .sign("RSA-SHA256", Buffer.from(data), privateKey)
      .toString("base64url")
  );
}
test("service receiver validates signature, application audience and current introspection without accepting suspended credentials", async () => {
  const fetch = global.fetch;
  let active = true;
  global.fetch = async (url, init) =>
    new Response(
      JSON.stringify(
        String(url).endsWith("/introspect")
          ? {
              active,
              aud: "atlas-api",
              client_id: "billing",
              scope: "billing.webhooks.deliver",
              exp: Math.floor(Date.now() / 1000) + 120,
            }
          : { keys: [key] },
      ),
      { status: 200 },
    );
  try {
    const tokens = new PaymentsServiceTokens(options);
    await tokens.verifyActive(jwt(), "billing", "billing.webhooks.deliver");
    for (const bad of [
      { aud: "balanz-api" },
      { client_id: "other" },
      { scope: "billing.other" },
      { email: "user@test" },
      { session_id: "session" },
      { exp: 1 },
      { sub: "user" },
      { iat: Math.floor(Date.now() / 1000) + 10 },
    ])
      await assert.rejects(
        tokens.verifyActive(jwt(bad), "billing", "billing.webhooks.deliver"),
      );
    active = false;
    await assert.rejects(
      tokens.verifyActive(jwt(), "billing", "billing.webhooks.deliver"),
    );
  } finally {
    global.fetch = fetch;
  }
});
test("receiver denies modified signatures and token introspection outages", async () => {
  const fetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ keys: [key] }));
  try {
    const tokens = new PaymentsServiceTokens(options);
    const value = jwt();
    const parts = value.split(".");
    parts[1] = Buffer.from(JSON.stringify({ x: true })).toString("base64url");
    await assert.rejects(
      tokens.verifyActive(
        parts.join("."),
        "billing",
        "billing.webhooks.deliver",
      ),
    );
    await assert.rejects(
      tokens.verifyActive(value, "billing", "billing.webhooks.deliver"),
    );
  } finally {
    global.fetch = fetch;
  }
});
test("readiness inspects schema metadata without reading protected tables or initializing migrations", async () => {
  const calls = [];
  const names = {
    payments_checkout_attempts: [
      "id",
      "organization_id",
      "subject_id",
      "product_code",
      "idempotency_key",
      "request_hash",
      "request_payload",
      "status",
      "checkout_id",
      "subscription_id",
      "checkout_url",
      "checkout_status",
      "subscription_status",
      "status_checked_at",
      "error_code",
    ],
    payments_licenses: [
      "organization_id",
      "product_code",
      "revision",
      "license",
      "confirmed_at",
      "received_at",
      "updated_at",
    ],
  };
  const store = new PaymentsStorage({
    dataSource: {
      query: async (sql, args) => {
        calls.push(sql);
        return args
          ? names[args[0]].map((attname) => ({ attname }))
          : [{ ready: true }];
      },
    },
  });
  assert.deepEqual(await store.ready(), { ready: true });
  assert(
    calls.every(
      (s) => s.includes("pg_catalog") || s.includes("to_regprocedure"),
    ),
  );
  assert(
    calls.every((s) => !s.includes("CREATE") && !s.includes("FROM public.")),
  );
});
test("DTO boundaries forbid caller-supplied identity, empty Legal evidence and contradictory active licenses", () => {
  const dto = {
    idempotencyKey: crypto.randomUUID(),
    planCode: "basic",
    planPriceCode: "monthly",
    legalAcceptanceId: crypto.randomUUID(),
  };
  assert.deepEqual(attemptInput(dto), dto);
  assert.throws(() => attemptInput({ ...dto, organizationId: org }));
  assert.deepEqual(attemptInput({ ...dto, legalAcceptanceId: undefined }), { ...dto, legalAcceptanceId: undefined });
  const { legalAcceptanceId, ...paymentsOnly } = dto;
  assert.deepEqual(attemptInput(paymentsOnly), paymentsOnly);
  for (const invalid of [null, '', 'invalid'])
    assert.throws(() => attemptInput({ ...dto, legalAcceptanceId: invalid }));
  const event = {
    type: "billing.license.updated",
    organizationId: org,
    productCode: "atlas",
    revision: "1",
    license: {
      active: false,
      productCode: "atlas",
      subscriptionId: null,
      planCode: null,
      licenseStatus: "revoked",
      validUntil: null,
      seatsLimit: 0,
      usageLimit: null,
      features: {},
    },
    checkouts: [],
  };
  assert.equal(webhookInput(event, "atlas").productCode, "atlas");
  assert.throws(() =>
    webhookInput({ ...event, productCode: "balanz_cfdi" }, "atlas"),
  );
  assert.throws(() =>
    webhookInput({ ...event, revision: "9223372036854775808" }, "atlas"),
  );
  assert.throws(() =>
    webhookInput(
      { ...event, license: { ...event.license, active: true } },
      "atlas",
    ),
  );
});
test("async module permits catalog-only settings and derives service endpoints from the existing connection", async () => {
  const module = PaymentsModule.forRootAsync({
    useFactory: () => ({
      connection,
      clientSecret: "secret",
      dataSource: {},
      authorize: async () => ({ organizationId: org, subjectId: subject }),
    }),
  });
  const provider = module.providers.find((p) => p.provide === PAYMENTS_OPTIONS);
  const normalized = await provider.useFactory();
  assert.equal(
    normalized.receiver.jwksUrl,
    "https://identity.test/.well-known/jwks.json",
  );
  assert.equal(
    normalized.receiver.introspectionUrl,
    "https://identity.test/oauth/introspect",
  );
  assert.equal(normalized.receiver.billingClientId, "");
  assert.equal(
    SERVICE_AUTHENTICATED_METADATA,
    "hemia.payments.service-authenticated",
  );
  assert.equal(normalized.legal, undefined);
  const { PaymentsService } = require("../../dist/nestjs");
  assert.doesNotThrow(() => new PaymentsService(normalized, {}));
});

test("GET status repair cannot overwrite a newer webhook and never queries Billing for a different organization", async () => {
  const { PaymentsService } = require("../../dist/nestjs");
  const id = crypto.randomUUID(),
    checkout = crypto.randomUUID(),
    subscription = crypto.randomUUID();
  let calls = 0;
  const row = {
    id,
    organization_id: org,
    subject_id: subject,
    product_code: "atlas",
    status: "ready",
    checkout_id: checkout,
    subscription_id: subscription,
    checkout_url: "https://www.sandbox.paypal.com/checkout",
    checkout_status: "pending",
    subscription_status: "pending",
    status_checked_at: null,
    request_payload: { planCode: "basic", planPriceCode: "monthly" },
  };
  const manager = {
    query: async (sql, args) => {
      assert.match(sql, /status_checked_at IS NULL/);
      if (row.status_checked_at === null) {
        row.checkout_status = args[3];
        row.subscription_status = args[4];
        row.status_checked_at = new Date();
      }
      return [];
    },
  };
  const store = {
    transaction: async (scope, work) => work(manager),
    byId: async (manager, organization, id) =>
      organization === org ? row : null,
  };
  const service = new PaymentsService(
    {
      ...options,
      dataSource: {},
      authorize: async () => ({ organizationId: org, subjectId: subject }),
    },
    store,
  );
  service.client.checkout.status = async () => {
    calls++;
    row.checkout_status = "approved";
    row.subscription_status = "active";
    row.status_checked_at = new Date();
    return {
      checkoutId: checkout,
      subscriptionId: subscription,
      checkoutStatus: "pending",
      subscriptionStatus: "pending",
      provider: "paypal",
    };
  };
  await assert.rejects(
    service.getAttempt(
      { organizationId: crypto.randomUUID(), subjectId: subject },
      id,
    ),
  );
  assert.equal(calls, 0);
  const repaired = await service.getAttempt(
    { organizationId: org, subjectId: subject },
    id,
  );
  assert.equal(repaired.checkoutStatus, "approved");
  assert.equal(repaired.subscriptionStatus, "active");
  assert.equal(repaired.statusFresh, true);
  assert.equal(calls, 1);
});
