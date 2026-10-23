require('reflect-metadata');
const { Module, Global } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { PaymentsModule } = require('@hemia/payments/nestjs');

async function startAtlas({ dataSource, connection, clientSecret, authorize, legal }) {
  // Represents the host's existing database module; payments never initializes it.
  class DatabaseModule {}
  Global()(DatabaseModule);
  Module({ providers: [{ provide: DataSource, useValue: dataSource }], exports: [DataSource] })(DatabaseModule);
  class AtlasModule {}
  Module({ imports: [DatabaseModule, PaymentsModule.forRootAsync({
    useFactory: () => ({ connection, clientSecret, authorize, ...(legal ? { legal } : {}) }),
  })] })(AtlasModule);
  const app = await NestFactory.create(AtlasModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return { app, url: `http://127.0.0.1:${app.getHttpServer().address().port}/api` };
}

module.exports = { startAtlas };
