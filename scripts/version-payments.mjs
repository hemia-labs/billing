import { withChangesetScope } from './changeset-scope.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageFile = join(root, 'packages/payments/package.json');
const lockFile = join(root, 'bun.lock');
const version = () => JSON.parse(readFileSync(packageFile, 'utf8')).version;
const before = version();

withChangesetScope('payments', () => execFileSync(process.execPath, [join(root, 'node_modules/@changesets/cli/bin.js'), 'version'], {
  cwd: root, stdio: 'inherit',
}));

const after = version();
assert.notEqual(after, before, 'Changesets did not update @hemia/payments');
const lock = readFileSync(lockFile, 'utf8');
const entry = /("packages\/payments":\s*\{\s*"name":\s*"@hemia\/payments",\s*"version":\s*")([^"]+)(")/g;
const matches = [...lock.matchAll(entry)];
assert.equal(matches.length, 1, 'Expected one @hemia/payments workspace in bun.lock');
assert.equal(matches[0][2], before, 'bun.lock and package.json had different versions');
writeFileSync(lockFile, lock.replace(entry, (_match, prefix, _old, suffix) => `${prefix}${after}${suffix}`));
assert.equal(JSON.parse(readFileSync(packageFile, 'utf8')).version, after);
console.log(`Payments version and workspace lock synchronized: ${after}`);
execFileSync('bun', ['install', '--frozen-lockfile'], { cwd: root, stdio: 'inherit' });
