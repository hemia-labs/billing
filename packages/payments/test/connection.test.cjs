const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolvePaymentsConnection,
  createPaymentsClient,
  createPaymentsReceiver,
} = require("../dist");
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
const options = {
  baseUrl: "https://billing.test",
  connectionCode: "portal",
  clientId: "consumer",
  clientSecret: "fixture-secret",
};
const metadata = {
  contract: "hemia.payments.connections.v1",
  issuer: "https://identity.test",
  tokenUrl: "https://identity.test/oauth/token",
  audience: "billing-api",
  resource: "https://billing.test",
  scope: "billing.integration.catalog.read",
  configurationPath:
    "/api/v1/billing/integrations/v1/connections/{connectionCode}",
};
const configuration = {
  issuer: metadata.issuer,
  tokenUrl: metadata.tokenUrl,
  clientId: options.clientId,
  baseUrl: "https://billing.test/api/v1",
  audience: metadata.audience,
  resource: metadata.resource,
  productCode: "portal",
  receiver: { audience: "portal-api" },
  legal: {
    baseUrl: "https://legal.test",
    resource: "https://legal.test",
    audience: "legal-api",
    verificationClientId: "legal-service",
  },
};
const envelope = () => ({
  contract: "hemia.payments.connection.v1",
  connectionCode: "portal",
  version: 1,
  configuration: structuredClone(configuration),
});
function server({
  discovery = metadata,
  response = envelope(),
  status = 200,
  tokenStatus = 200,
} = {}) {
  const requests = [];
  global.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    if (url.endsWith("/discovery")) {
      assert.equal(new Headers(init.headers).has("authorization"), false);
      assert.equal(init.body, undefined);
      return Response.json(discovery);
    }
    if (url === metadata.tokenUrl) {
      assert.equal(init.body.get("client_id"), options.clientId);
      assert.equal(init.body.get("client_secret"), options.clientSecret);
      assert.equal(init.body.get("scope"), metadata.scope);
      assert.equal(init.body.get("resource"), metadata.resource);
      return Response.json(
        tokenStatus === 200
          ? {
              access_token: "fixture-token",
              token_type: "Bearer",
              expires_in: 300,
              scope: metadata.scope,
            }
          : { error: "invalid_client", detail: options.clientSecret },
        { status: tokenStatus },
      );
    }
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer fixture-token",
    );
    if (url.endsWith("/connections/portal"))
      return Response.json(response, { status });
    if (url.endsWith("/catalog/products/portal/plans"))
      return Response.json([]);
    throw new Error("Unexpected request");
  };
  return requests;
}

test("connection resolver loads authorized configuration once and ordinary payments use the resolved snapshot", async () => {
  const requests = server();
  const resolved = await resolvePaymentsConnection(options);
  assert.deepEqual(resolved, configuration);
  assert.equal("clientSecret" in resolved, false);
  const payments = createPaymentsClient({
    ...resolved,
    clientSecret: options.clientSecret,
  });
  assert.deepEqual(await payments.catalog.listPlans(), []);
  assert.equal(
    requests.filter(({ url }) => url.endsWith("/discovery")).length,
    1,
  );
  assert.equal(
    requests.filter(({ url }) => url.endsWith("/connections/portal")).length,
    1,
  );
  const receiver = createPaymentsReceiver({
    ...resolved,
    clientSecret: options.clientSecret,
  });
  await assert.rejects(
    receiver.verifyLegal({ authorization: "Bearer invalid" }),
    { code: "authentication", status: 401 },
  );
  await assert.rejects(
    receiver.verifyConsole({ authorization: "Bearer invalid" }),
    { code: "configuration", status: 503 },
  );
});

test("connection resolver rejects token failures and denied or unpublished connections without leaking credentials", async () => {
  for (const failure of [
    { tokenStatus: 401 },
    { status: 403 },
    { status: 404 },
  ]) {
    server(failure);
    await assert.rejects(resolvePaymentsConnection(options), (error) => {
      assert.equal(error.name, "PaymentsError");
      assert.equal(error.message.includes(options.clientSecret), false);
      assert.equal(error.status, failure.tokenStatus ?? failure.status);
      return true;
    });
  }
});

test("connection resolver rejects untrusted metadata before submitting credentials", async () => {
  for (const change of [
    { resource: "https://other.test" },
    { configurationPath: "https://other.test/config" },
    { tokenUrl: "https://other.test/token" },
    { issuer: "http://identity.test", tokenUrl: "http://identity.test/token" },
    { scope: "billing.integration.checkout.create" },
  ]) {
    const requests = server({ discovery: { ...metadata, ...change } });
    await assert.rejects(resolvePaymentsConnection(options), {
      code: "contract",
      status: 502,
    });
    assert.equal(requests.length, 1);
  }
});

test("connection resolver rejects another owner, unexpected secrets and foreign destinations", async () => {
  for (const change of [
    { clientId: "another-client" },
    { baseUrl: "https://other.test/api/v1" },
    { issuer: "https://other.test" },
    { audience: "other-api" },
    { clientSecret: "must-not-be-returned" },
    { receiver: { audience: "portal-api", clientSecret: "hidden" } },
    { legal: { ...configuration.legal, baseUrl: "http://remote.test" } },
  ]) {
    server({
      response: {
        ...envelope(),
        configuration: { ...configuration, ...change },
      },
    });
    await assert.rejects(resolvePaymentsConnection(options), {
      code: "contract",
      status: 502,
    });
  }
});

test("connection resolver rejects invalid bootstrap inputs and bounds configuration payloads", async () => {
  for (const change of [
    { connectionCode: undefined },
    { connectionCode: "../portal" },
    { connectionCode: "discovery" },
    { baseUrl: "https://billing.test/other" },
    { baseUrl: "http://billing.test" },
    { requestTimeoutMs: 30001 },
  ]) {
    let called = false;
    global.fetch = async () => {
      called = true;
      throw new Error();
    };
    await assert.rejects(resolvePaymentsConnection({ ...options, ...change }), {
      code: "configuration",
      status: 400,
    });
    assert.equal(called, false);
  }
  server({ response: { ...envelope(), padding: "x".repeat(65536) } });
  await assert.rejects(resolvePaymentsConnection(options), {
    code: "contract",
    status: 502,
  });
});
