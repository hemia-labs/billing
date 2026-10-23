const { test } = require("node:test");
const assert = require("node:assert/strict");
require("reflect-metadata");
const { Global, Module } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { DataSource } = require("typeorm");
const { PaymentsModule, PaymentsService } = require("../../dist/nestjs");
const { PAYMENTS_OPTIONS } = require("../../dist/nestjs/types");
const connection = {
  issuer: "https://identity.test",
  tokenUrl: "https://identity.test/oauth/token",
  baseUrl: "https://billing.test/api/v1",
  audience: "billing-api",
  clientId: "atlas",
  productCode: "atlas",
};
const authorize = async () => ({
  organizationId: "unused",
  subjectId: "unused",
});
const dataSource = {
  query() {
    throw new Error("Startup must not query or migrate");
  },
  transaction() {
    throw new Error("Startup must not open a transaction");
  },
};
function configured(value) {
  const module = PaymentsModule.forRootAsync({ useFactory: () => value });
  return module.providers
    .find((p) => p.provide === PAYMENTS_OPTIONS)
    .useFactory();
}

test("Nest ignores an unrelated host database and preserves factory dependency injection", async () => {
  class DatabaseModule {}
  Global()(DatabaseModule);
  Module({
    providers: [
      { provide: DataSource, useValue: dataSource },
      { provide: "secret", useValue: "test-secret" },
    ],
    exports: [DataSource, "secret"],
  })(DatabaseModule);
  class HostModule {}
  Module({
    imports: [
      DatabaseModule,
      PaymentsModule.forRootAsync({
        inject: ["secret"],
        useFactory: (clientSecret) => ({
          connection: JSON.stringify(connection),
          clientSecret,
          authorize,
        }),
      }),
    ],
  })(HostModule);
  const app = await NestFactory.createApplicationContext(HostModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const options = app.get(PaymentsService).options;
    assert.deepEqual(options.connection, connection);
    assert.equal(options.dataSource, undefined);
    assert.equal(options.clientSecret, "test-secret");
    assert.equal(options.legal, undefined);
  } finally {
    await app.close();
  }
});

test("explicit DataSource supports hosts without a default database provider", async () => {
  class HostModule {}
  Module({
    imports: [
      PaymentsModule.forRootAsync({
        useFactory: () => ({
          connection,
          clientSecret: "test-secret",
          authorize,
          dataSource,
        }),
      }),
    ],
  })(HostModule);
  const app = await NestFactory.createApplicationContext(HostModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    assert.equal(app.get(PaymentsService).options.dataSource, dataSource);
  } finally {
    await app.close();
  }
});

test("missing authorization and malformed connection fail, while a database is optional", async () => {
  const base = {
    connection,
    clientSecret: "private-secret",
    authorize,
    dataSource,
  };
  for (const invalid of [
    "{private-secret",
    "null",
    "[]",
    "{}",
    JSON.stringify({
      ...connection,
      tokenUrl: "http://public.test/private-secret",
    }),
  ]) {
    await assert.rejects(
      configured({ ...base, connection: invalid }),
      (error) => {
        assert.equal(
          error.message,
          "Invalid PAYMENTS_CONNECTION or client secret",
        );
        assert.equal(error.message.includes("private-secret"), false);
        return true;
      },
    );
  }
  assert.equal(
    (await configured({ ...base, dataSource: undefined })).dataSource,
    undefined,
  );
  await assert.rejects(
    configured({ ...base, authorize: undefined }),
    /authorize callback/,
  );
});

test("Legal callback inherits Console endpoints only when explicitly enabled and rejects incomplete configuration", async () => {
  const legal = {
    baseUrl: "https://legal.test",
    audience: "legal-api",
    resource: "https://legal.test",
    verificationClientId: "legal-validator",
  };
  const resolveContext = async () => {
    throw new Error("Not used at startup");
  };
  const base = {
    connection: { ...connection, legal },
    clientSecret: "test-secret",
    authorize,
    dataSource,
  };
  assert.equal((await configured(base)).legal, undefined);
  assert.deepEqual(
    (await configured({ ...base, legal: { resolveContext } })).legal,
    { ...legal, resolveContext },
  );
  assert.deepEqual(
    (await configured({ ...base, legal: { ...legal, resolveContext } })).legal,
    { ...legal, resolveContext },
  );
  await assert.rejects(
    configured({ ...base, connection, legal: { resolveContext } }),
    /Legal requires/,
  );
  await assert.rejects(configured({ ...base, legal: {} }), /resolveContext/);
  await assert.rejects(
    configured({
      ...base,
      legal: { resolveContext, baseUrl: "http://public.test/private" },
    }),
    /Invalid Payments Legal endpoint/,
  );
});
