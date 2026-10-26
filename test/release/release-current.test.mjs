import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isCurrentMain } from '../../scripts/release-current.mjs';

test('only the exact current main may update a version PR; missing or malformed refs fail closed', () => {
  const sha = 'a'.repeat(40);
  assert(isCurrentMain(sha, `${sha}\trefs/heads/main\n`));
  assert(!isCurrentMain('b'.repeat(40), `${sha}\trefs/heads/main\n`));
  for (const value of ['', `${sha} refs/heads/other`, 'not-a-sha refs/heads/main'])
    assert.throws(() => isCurrentMain(sha, value));
  assert.throws(() => isCurrentMain('', `${sha} refs/heads/main`));
});

test('obsolete runs skip updates and only stale failures are suppressed, using real remote refs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'billing-current-'));
  const script = resolve('scripts/release-current.mjs');
  try {
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-b', 'main');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'Fixture');
    git('remote', 'add', 'origin', directory);
    writeFileSync(join(directory, 'fixture'), 'one');
    git('add', '.'); git('commit', '-m', 'one');
    const old = git('rev-parse', 'HEAD');
    const run = (command, sha) => spawnSync(process.execPath, [script, command], {
      cwd: directory, encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, GITHUB_OUTPUT: join(directory, 'output') },
    });
    assert.equal(run('check', old).status, 0);
    assert.notEqual(run('recover', old).status, 0, 'A real failure on current main must fail the workflow');
    writeFileSync(join(directory, 'fixture'), 'two');
    git('add', 'fixture'); git('commit', '-m', 'two');
    assert.match(run('check', old).stdout, /Skipping obsolete/);
    assert.equal(run('recover', old).status, 0);
    git('remote', 'set-url', 'origin', join(directory, 'missing'));
    assert.notEqual(run('check', old).status, 0, 'Network/remote errors must not permit updates');
    assert.notEqual(run('recover', old).status, 0, 'Remote errors must not hide a failed update');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
