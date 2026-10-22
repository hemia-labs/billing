const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PaymentsLegalService } = require("../../dist/nestjs/legal.service");
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

for (const prefix of ["", "/proxy", "/proxy/"]) {
  test(`Legal prepare and accept preserve base URL prefix ${prefix || "(root)"}`, async () => {
    const baseUrl = "https://legal.test" + prefix;
    const expectedBase = baseUrl.replace(/\/+$/, "");
    const calls = [];
    const requestId = randomUUID(),
      identitySourceId = randomUUID();
    const legalAcceptanceId = randomUUID();
    const document = {
      documentId: randomUUID(),
      documentVersionId: randomUUID(),
      contentHash: "a".repeat(64),
      title: "Terms",
      version: "1",
      kind: "terms",
      artifacts: { html: { url: expectedBase + "/documents/terms.html" } },
    };
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === "https://identity.test/oauth/token") {
        return Response.json({
          access_token: "fixture-token",
          token_type: "Bearer",
          expires_in: 300,
          scope: init.body.get("scope"),
        });
      }
      const body = JSON.parse(init.body);
      if (
        String(url) ===
        expectedBase + "/v1/legal/integrations/acceptance-requests"
      ) {
        return Response.json({
          requestId,
          identitySourceId,
          productCode: "atlas",
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          documents: [document],
        });
      }
      assert.equal(
        String(url),
        expectedBase + "/v1/legal/integrations/acceptances",
      );
      assert.equal(body.requestId, requestId);
      return Response.json({
        requestId,
        identitySourceId,
        productCode: "atlas",
        legalAcceptanceId,
        accepted: true,
      });
    };
    const service = new PaymentsLegalService({
      connection: {
        issuer: "https://identity.test",
        tokenUrl: "https://identity.test/oauth/token",
        clientId: "atlas-backend",
        productCode: "atlas",
      },
      clientSecret: "fixture-secret",
      legal: {
        baseUrl,
        audience: "legal-api",
        resource: "https://legal.test",
        verificationClientId: "legal-validator",
      },
    });
    const context = {
      organizationId: randomUUID(),
      subjectId: randomUUID(),
      sessionId: randomUUID(),
    };
    const prepared = await service.prepare(context, randomUUID());
    assert.equal(prepared.requestId, requestId);
    const accepted = await service.accept(context, {
      requestId,
      idempotencyKey: randomUUID(),
      confirmations: [
        {
          documentVersionId: document.documentVersionId,
          contentHash: document.contentHash,
          accepted: true,
        },
      ],
    });
    assert.equal(accepted.legalAcceptanceId, legalAcceptanceId);
    const requests = calls.filter((call) =>
      call.url.startsWith("https://legal.test"),
    );
    assert.deepEqual(
      requests.map((call) => call.url),
      [
        expectedBase + "/v1/legal/integrations/acceptance-requests",
        expectedBase + "/v1/legal/integrations/acceptances",
      ],
    );
    for (const { init } of requests) {
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      assert.equal(
        new Headers(init.headers).get("authorization"),
        "Bearer fixture-token",
      );
      assert.equal(
        JSON.parse(init.body).organizationId,
        context.organizationId,
      );
      assert.equal(JSON.parse(init.body).subjectId, context.subjectId);
    }
    assert.deepEqual(
      calls
        .filter((call) => call.url.startsWith("https://identity.test"))
        .map(({ init }) => init.body.get("scope")),
      [
        "legal.integration.acceptances.prepare",
        "legal.integration.acceptances.create",
      ],
    );
  });
}
