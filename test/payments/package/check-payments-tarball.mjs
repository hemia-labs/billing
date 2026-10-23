import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packageDir = join(root, 'packages/payments');
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const temporary = mkdtempSync(join(tmpdir(), 'hemia-payments-pack-'));
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, npm_config_cache: join(temporary, 'npm-cache') },
});
const exportPaths = (value) => typeof value === 'string'
  ? [value]
  : Object.values(value).flatMap(exportPaths);

try {
  assert.equal(manifest.name, '@hemia/payments');
  assert.equal(manifest.repository?.url, 'git+https://github.com/hemia-labs/billing.git');
  assert.equal(manifest.repository?.directory, 'packages/payments');
  assert.equal(manifest.publishConfig?.access, 'public');
  for (const group of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(manifest[group] ?? {})) {
      assert(!/^(?:file|link|workspace):/.test(range), `Published ${group}.${name} must use a registry version`);
    }
  }
  const [packed] = JSON.parse(run('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
  ], packageDir));
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.equal(packed.filename, `hemia-payments-${manifest.version}.tgz`);
  const tarball = join(temporary, packed.filename);
  const files = new Set(packed.files.map(file => file.path));
  for (const path of exportPaths(manifest.exports)) {
    assert(files.has(path.replace(/^\.\//, '')), `Missing export: ${path}`);
  }
  const packedManifest = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json'], root));
  assert.deepEqual(packedManifest, manifest);

  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  const dependencies = {
    '@hemia/payments': `file:${tarball}`,
    '@hemia/auth': manifest.devDependencies['@hemia/auth'],
    '@types/node': '24.0.0',
    '@nestjs/common': '11.1.6',
    '@nestjs/core': '11.1.6',
    'reflect-metadata': '0.2.2',
    'rxjs': '7.8.2',
  };
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    name: 'payments-tarball-smoke', private: true, type: 'module', dependencies,
  }, null, 2) + '\n');
  run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock',
  ], consumer);
  writeFileSync(join(consumer, 'check.cjs'), `
const assert = require('node:assert/strict');
require('reflect-metadata');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const core = require('@hemia/payments');
const { PaymentsModule, PaymentsService, PaymentsSchema1792886400000 } = require('@hemia/payments/nestjs');
assert.equal(typeof core.createPaymentsClient, 'function');
assert.equal(typeof PaymentsModule.forRootAsync, 'function');
assert.equal(typeof PaymentsSchema1792886400000.prototype.up, 'function');
const connection = {
  issuer: 'https://identity.test', tokenUrl: 'https://identity.test/oauth/token',
  baseUrl: 'https://billing.test/api/v1', audience: 'billing-api',
  clientId: 'atlas-backend', productCode: 'atlas',
  legal: { baseUrl: 'https://legal.test', audience: 'legal-api', resource: 'https://legal.test', verificationClientId: 'legal-validator' },
};
const authorize = async () => { throw new Error('Startup must not authorize'); };
const resolveContext = async () => { throw new Error('Startup must not resolve Legal context'); };
(async () => {
  for (const legal of [undefined, { resolveContext }]) {
    class HostModule {}
    Module({ imports: [PaymentsModule.forRootAsync({
      useFactory: () => ({ connection: JSON.stringify(connection), clientSecret: 'fixture-only-secret', authorize, ...(legal ? { legal } : {}) }),
    })] })(HostModule);
    const app = await NestFactory.createApplicationContext(HostModule, { logger: false, abortOnError: false });
    try {
      const options = app.get(PaymentsService).options;
      assert.equal(Object.hasOwn(options, "dataSource"), false);
      assert.deepEqual(options.connection, connection);
      assert.equal(options.authorize, authorize);
      assert.deepEqual(options.legal, legal ? { ...connection.legal, resolveContext } : undefined);
    } finally { await app.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
`);
  writeFileSync(join(consumer, 'check.mjs'), `
import assert from 'node:assert/strict';
import { createPaymentsClient, PaymentsError } from '@hemia/payments';
import { PaymentsModule, PaymentsService, PaymentsSchema1792886400000 } from '@hemia/payments/nestjs';
assert.equal(typeof createPaymentsClient, 'function');
assert.equal(typeof PaymentsError, 'function');
assert.equal(typeof PaymentsModule.forRootAsync, 'function');
assert.equal(typeof PaymentsService, 'function');
assert.equal(typeof PaymentsSchema1792886400000.prototype.up, 'function');
`);
  run(process.execPath, ['check.cjs'], consumer);
  run(process.execPath, ['check.mjs'], consumer);
  writeFileSync(join(consumer, 'check.ts'), `
import { createPaymentsClient, createPaymentsReceiver, snapshotAccess, type PaymentSnapshot } from '@hemia/payments';
import { PaymentsModule, type PaymentsModuleOptions } from '@hemia/payments/nestjs';
const options: PaymentsModuleOptions = {
  connection: { issuer: 'https://identity.test', tokenUrl: 'https://identity.test/oauth/token', clientId: 'consumer', baseUrl: 'https://billing.test/api/v1', audience: 'billing-api', productCode: 'product' },
  clientSecret: 'fixture-only',
  authorize: async () => ({ organizationId: '00000000-0000-4000-8000-000000000001', subjectId: '00000000-0000-4000-8000-000000000002' }),
  onSnapshot: async (snapshot: PaymentSnapshot) => ({ applied: snapshotAccess(snapshot).active }),
};
PaymentsModule.forRootAsync({ useFactory: () => options });
void createPaymentsClient;
void createPaymentsReceiver;
`);
  run(process.execPath, [join(root, 'apps/api/node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'ES2023', '--module', 'Node16', '--moduleResolution', 'Node16', '--esModuleInterop', '--types', 'node', 'check.ts'], consumer);

  if (process.env.PAYMENTS_RELEASE_DIR) {
    const output = resolve(process.env.PAYMENTS_RELEASE_DIR);
    mkdirSync(output, { recursive: true });
    copyFileSync(tarball, join(output, packed.filename));
    writeFileSync(join(output, 'release.json'), JSON.stringify({
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      name: manifest.name,
      version: manifest.version,
      filename: packed.filename,
      integrity: `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`,
    }, null, 2) + '\n');
  }
  console.log(`${manifest.name}@${manifest.version}: installed tarball, CJS/ESM exports, database-free Node/Nest and optional Legal PASS`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
