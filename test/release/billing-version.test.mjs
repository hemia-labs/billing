import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { billingChangeset, isBillingVersionBatch, retryReleaseTag } from '../../scripts/billing-version.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const note = '---\n"api": major\n---\nInitial Billing release.\n';
const files = ['apps/api/package.json', 'apps/web/package.json', 'apps/api/CHANGELOG.md', 'apps/web/CHANGELOG.md', 'bun.lock', '.changeset/billing.md'];
const removed = [{ path: '.changeset/billing.md', source: note }];
const before = { api: '0.1.0', web: '0.1.0' };
const after = { api: '1.0.0', web: '1.0.0' };

test('only complete version merges consuming Billing changesets can publish', () => {
  assert(isBillingVersionBatch(before, after, files, removed));
  assert.equal(isBillingVersionBatch(before, before, files, removed), false);
  assert.equal(isBillingVersionBatch(before, after, [...files, 'apps/api/src/main.ts'], removed), false);
  assert.equal(isBillingVersionBatch(before, after, files.slice(1), removed), false);
  assert.equal(isBillingVersionBatch(before, after, files, []), false);
  assert.equal(billingChangeset('---\n"@hemia/auth": patch\n---\nSDK'), false);
  assert.throws(() => isBillingVersionBatch(after, before, files, removed), /must increase/);
  assert.throws(() => isBillingVersionBatch(before, { ...after, web: '2.0.0' }, files, removed), /share a version/);
});

test('retry accepts only the committed shared stable version', () => {
  assert.equal(retryReleaseTag('billing-v1.0.0', '1.0.0', '1.0.0'), 'billing-v1.0.0');
  assert.throws(() => retryReleaseTag('billing-v1.0.1', '1.0.0', '1.0.0'));
  assert.throws(() => retryReleaseTag('billing-v1.0.0', '1.0.0', '1.0.1'));
  assert.throws(() => retryReleaseTag('billing-v1.0.0-rc.1', '1.0.0-rc.1', '1.0.0-rc.1'));
});

test('real Changesets produces synchronized packages, lock, changelogs, tag and release notes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'billing-version-'));
  try {
    for (const folder of ['apps/api', 'apps/web', 'packages/payments', '.changeset', 'scripts', 'bin']) mkdirSync(join(dir, folder), { recursive: true });
    for (const path of ['package.json', 'bun.lock', 'apps/api/package.json', 'apps/web/package.json', '.changeset/config.json',
      'scripts/billing-version.mjs', 'scripts/version-billing.mjs', 'scripts/changeset-scope.mjs', 'scripts/version-payments.mjs', 'packages/payments/package.json']) copyFileSync(join(root, path), join(dir, path));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture');
    writeFileSync(join(dir, '.changeset/billing.md'), note);
    const paymentsNote = '---\n"@hemia/payments": patch\n---\nSDK-only change.\n';
    writeFileSync(join(dir, '.changeset/payments.md'), paymentsNote);
    writeFileSync(join(dir, '.changeset/empty.md'), '---\n---\n');
    const originalConfig = readFileSync(join(dir, '.changeset/config.json'), 'utf8');
    const originalPayments = readFileSync(join(dir, 'packages/payments/package.json'), 'utf8');
    git('add', '.changeset');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'functional change');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const cli = (...args) => execFileSync(process.execPath, [join(dir, 'scripts/billing-version.mjs'), ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    assert(cli('pending').includes('true'));
    writeFileSync(join(dir, 'bin/bun'), '#!/bin/sh\ntest "$*" = "install --frozen-lockfile"\n', { mode: 0o755 });
    execFileSync(process.execPath, [join(dir, 'scripts/version-billing.mjs')], {
      cwd: dir, env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` }, stdio: 'pipe',
    });
    const versions = ['api', 'web'].map(name => JSON.parse(readFileSync(join(dir, 'apps', name, 'package.json'))).version);
    assert.equal(versions[0], versions[1]);
    const lock = readFileSync(join(dir, 'bun.lock'), 'utf8');
    for (const name of ['api', 'web']) {
      assert(lock.split(`"apps/${name}": {`)[1].split('}')[0].includes(`"version": "${versions[0]}"`));
      assert(readFileSync(join(dir, 'apps', name, 'CHANGELOG.md'), 'utf8').includes(`## ${versions[0]}`));
    }
    assert(cli('pending').includes('false'));
    assert.equal(readFileSync(join(dir, '.changeset/payments.md'), 'utf8'), paymentsNote);
    assert.equal(readFileSync(join(dir, '.changeset/empty.md'), 'utf8'), '---\n---\n');
    assert.equal(readFileSync(join(dir, 'packages/payments/package.json'), 'utf8'), originalPayments);
    assert.equal(readFileSync(join(dir, '.changeset/config.json'), 'utf8'), originalConfig);
    const base = git('rev-parse', 'HEAD');
    git('add', 'apps', '.changeset', 'bun.lock');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'version');
    assert(cli('classify', base).includes(`Billing version-only merge: billing-v${versions[0]}`));
    assert(cli('notes').includes('Initial Billing release.'));
    assert(cli('retry', `billing-v${versions[0]}`).includes('Explicit unpublished release retry'));
    writeFileSync(join(dir, '.changeset/billing-next.md'), note);
    execFileSync(process.execPath, [join(dir, 'scripts/version-payments.mjs')], {
      cwd: dir, env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` }, stdio: 'pipe',
    });
    assert.equal(readFileSync(join(dir, '.changeset/billing-next.md'), 'utf8'), note);
    assert.equal(JSON.parse(readFileSync(join(dir, 'apps/api/package.json'))).version, versions[0]);
    assert.notEqual(readFileSync(join(dir, 'packages/payments/package.json'), 'utf8'), originalPayments);
    assert.equal(readFileSync(join(dir, '.changeset/config.json'), 'utf8'), originalConfig);
    const scoped = `import assert from 'node:assert/strict'; import { withChangesetScope } from './scripts/changeset-scope.mjs'; assert.throws(() => withChangesetScope('payments', () => { throw Error('fixture failure'); }), /fixture failure/);`;
    execFileSync(process.execPath, ['--input-type=module', '-e', scoped], { cwd: dir, stdio: 'pipe' });
    assert.equal(readFileSync(join(dir, '.changeset/billing-next.md'), 'utf8'), note);
    assert.equal(readFileSync(join(dir, '.changeset/config.json'), 'utf8'), originalConfig);
    writeFileSync(join(dir, '.changeset/mixed.md'), '---\n"api": patch\n"@hemia/payments": patch\n---\nMixed.\n');
    execFileSync(process.execPath, ['--input-type=module', '-e', scoped.replace('/fixture failure/', '/cross-scope/')], { cwd: dir, stdio: 'pipe' });
    assert.equal(readFileSync(join(dir, '.changeset/config.json'), 'utf8'), originalConfig);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
