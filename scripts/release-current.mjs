import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isCurrentMain(expected, remote) {
  assert(/^[a-f0-9]{40}$/.test(expected ?? ''), 'Expected the workflow commit');
  const match = remote.trim().match(/^([a-f0-9]{40})\s+refs\/heads\/main$/);
  assert(match, 'Could not resolve current main');
  return match[1] === expected;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  assert(['check', 'recover'].includes(command), 'Expected check or recover');
  const remote = execFileSync('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const current = isCurrentMain(process.env.GITHUB_SHA, remote);
  if (command === 'recover') {
    assert(!current, 'Version PR update failed on current main; inspect the failed action');
    console.log('Main advanced during the PR update; the newer workflow owns the next version PR.');
  } else {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `current=${current}\n`);
    console.log(current ? 'Workflow is current' : 'Skipping obsolete version PR update');
  }
}
