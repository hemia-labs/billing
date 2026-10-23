import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { isReviewedVersionBatch, registryDecision, assertAuthVersions, validateArtifact, changelogNotes, createGitHubRelease, waitForRegistryVisibility } from '../../scripts/payments-release.mjs';

const versionFiles = ['packages/payments/package.json', 'packages/payments/CHANGELOG.md', 'bun.lock', '.changeset/payments-sdk.md'];
const deleted = ['.changeset/payments-sdk.md'];

test('only version merges consuming a changeset can publish; initial package and code merges cannot', () => {
  assert.equal(isReviewedVersionBatch('0.2.0', '0.3.0', versionFiles, deleted), true);
  assert.equal(isReviewedVersionBatch(null, '0.2.0', versionFiles, deleted), false);
  assert.equal(isReviewedVersionBatch('0.2.0', '0.2.0', versionFiles, deleted), false);
  assert.equal(isReviewedVersionBatch('0.2.0', '0.3.0', [...versionFiles, 'packages/payments/src/index.ts'], deleted), false);
  assert.equal(isReviewedVersionBatch('0.2.0', '0.3.0', versionFiles, []), false);
  assert.equal(isReviewedVersionBatch('0.2.0', '0.3.0', versionFiles.filter((file) => file !== 'bun.lock'), deleted), false);
  assert.throws(() => isReviewedVersionBatch('0.3.0', '0.2.0', versionFiles, deleted), /must increase/);
});

test('registry preflight requires bootstrap and refuses mutated versions or rollback', () => {
  const metadata = { 'dist-tags': { latest: '0.2.0' }, versions: { '0.2.0': { dist: { integrity: 'sha512-original' } } } };
  assert.throws(() => registryDecision(null, '0.3.0', 'sha512-next'), /must already exist on npm/);
  assert.equal(registryDecision(metadata, '0.3.0', 'sha512-next'), 'publish');
  assert.equal(registryDecision(metadata, '0.2.0', 'sha512-original'), 'already-published');
  assert.throws(() => registryDecision(metadata, '0.2.0', 'sha512-modified'), /different tarball/);
  assert.throws(() => registryDecision(metadata, '0.1.0', 'sha512-old'), /backwards/);
});

test('Auth availability must be a real registry version matching npm peer resolution', () => {
  assert.doesNotThrow(() => assertAuthVersions('1.1.0'));
  assert.doesNotThrow(() => assertAuthVersions(['1.1.0', '1.1.1']));
  for (const invalid of [null, undefined, [], {}, '', ['1.1.0', null]]) assert.throws(() => assertAuthVersions(invalid), /compatible @hemia\/auth/);
});

test('the validated tarball is bound to exact checkout, metadata and bytes', () => {
  const bytes = Buffer.from('validated artifact');
  const manifest = { name: '@hemia/payments', version: '0.3.0', repository: { url: 'git+https://github.com/hemia-labs/billing.git' }, publishConfig: { access: 'public' } };
  const release = { name: manifest.name, version: manifest.version, filename: 'hemia-payments-0.3.0.tgz', commit: 'commit', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
  assert.doesNotThrow(() => validateArtifact(release, manifest, manifest, 'commit', bytes));
  assert.throws(() => validateArtifact(release, manifest, manifest, 'another-commit', bytes), /commit differs/);
  assert.throws(() => validateArtifact(release, manifest, manifest, 'commit', Buffer.from('changed')), /integrity changed/);
  assert.throws(() => validateArtifact(release, manifest, { ...manifest, version: '9.0.0' }, 'commit', bytes), /manifest differs/);
});


test('Changesets notes include only the exact version, preserving its Markdown', () => {
  const changelog = '# @hemia/payments\n\n## 0.3.0\n\n### Minor Changes\n\n- Add **Legal**.\n\n## 0.2.0\n\n- Old notes.\n';
  assert.equal(changelogNotes(changelog, '0.3.0'), '### Minor Changes\n\n- Add **Legal**.');
  assert.equal(changelogNotes(changelog.replaceAll('\n', '\r\n'), '0.2.0'), '- Old notes.');
  assert.throws(() => changelogNotes(changelog, '0.4.0'), /Missing changelog/);
  assert.throws(() => changelogNotes('## 0.3.0\n\n## 0.2.0\nold', '0.3.0'), /Empty changelog/);
});

const releaseInput = { version: '0.3.0', commit: 'a'.repeat(40), notes: '### Minor Changes\n\n- SDK integration.', token: 'fixture-only' };
const tagName = '@hemia/payments@0.3.0';
const ref = { object: { type: 'commit', sha: releaseInput.commit } };
const githubFixture = (responses) => {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ path: url.replace('https://api.github.com/repos/hemia-labs/billing/', ''), method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
      assert.equal(options.headers.Authorization, 'Bearer fixture-only');
      assert.equal(options.redirect, 'error');
      assert(responses.length, 'Unexpected GitHub request');
      const [status, body] = responses.shift();
      return new Response(JSON.stringify(body), { status });
    },
  };
};

test('GitHub Release creates the exact tag and title at the validated commit with changelog notes', async () => {
  const fixture = githubFixture([[404, {}], [201, ref], [404, {}], [201, {}]]);
  await createGitHubRelease(releaseInput, fixture.request);
  assert.deepEqual(fixture.calls.map(({path, method}) => [path, method]), [
    ['git/ref/tags/%40hemia%2Fpayments%400.3.0', 'GET'], ['git/refs', 'POST'],
    ['releases/tags/%40hemia%2Fpayments%400.3.0', 'GET'], ['releases', 'POST'],
  ]);
  assert.deepEqual(fixture.calls[1].body, { ref: `refs/tags/${tagName}`, sha: releaseInput.commit });
  assert.deepEqual(fixture.calls[3].body, { tag_name: tagName, target_commitish: releaseInput.commit, name: tagName, body: releaseInput.notes, draft: false, prerelease: false });
});

test('reruns preserve an existing tag and release and recover after tag creation only', async () => {
  const existing = { tag_name: tagName, name: tagName, draft: false, prerelease: false };
  const complete = githubFixture([[200, ref], [200, existing]]);
  await createGitHubRelease(releaseInput, complete.request);
  assert(complete.calls.every(call => call.method === 'GET'));
  const partial = githubFixture([[200, ref], [404, {}], [201, {}]]);
  await createGitHubRelease(releaseInput, partial.request);
  assert.deepEqual(partial.calls.filter(call => call.method === 'POST').map(call => call.path), ['releases']);
});

test('GitHub failures and a tag on another commit fail closed without rewriting a tag', async () => {
  const wrong = githubFixture([[200, { object: { type: 'commit', sha: 'b'.repeat(40) } }]]);
  await assert.rejects(createGitHubRelease(releaseInput, wrong.request), /another commit/);
  assert.equal(wrong.calls.length, 1);
  for (const status of [403, 500]) {
    const failed = githubFixture([[status, { message: 'provider details' }]]);
    await assert.rejects(createGitHubRelease(releaseInput, failed.request), new RegExp(`HTTP ${status}$`));
    assert.equal(failed.calls.length, 1);
  }
  const noToken = githubFixture([]);
  await assert.rejects(createGitHubRelease({ ...releaseInput, token: '' }, noToken.request), /GH_TOKEN/);
  assert.equal(noToken.calls.length, 0);
});


test('registry visibility waits through minutes of npm processing, even when latest already advanced', async () => {
  let elapsed = 0, reads = 0;
  const sleeps = [];
  await waitForRegistryVisibility('0.4.1', 'sha512-expected', {
    now: () => elapsed,
    sleep: async (ms) => { sleeps.push(ms); elapsed += ms; },
    read: async () => {
      reads++;
      return elapsed < 180_000
        ? { 'dist-tags': { latest: '0.4.1' }, versions: {} }
        : { versions: { '0.4.1': { dist: { integrity: 'sha512-expected' } } } };
    },
  });
  assert.equal(elapsed, 180_000);
  assert.equal(reads, 10);
  assert(sleeps.every(ms => ms === 20_000));
});

test('registry visibility refuses different bytes immediately and never waits after confirmation', async () => {
  const sleep = async () => assert.fail('Unexpected wait');
  const read = async () => ({ versions: { '0.4.1': { dist: { integrity: 'sha512-actual' } } } });
  await assert.rejects(waitForRegistryVisibility('0.4.1', 'sha512-wrong', { read, sleep }), /different tarball/);
  await waitForRegistryVisibility('0.4.1', 'sha512-actual', { read, sleep });
});

test('registry visibility times out with recovery instructions without publishing or creating a release', async () => {
  let elapsed = 0, reads = 0;
  await assert.rejects(waitForRegistryVisibility('0.4.1', 'sha512-expected', {
    now: () => elapsed,
    sleep: async (ms) => { elapsed += ms; },
    read: async () => { reads++; return null; },
  }), /after 10 minutes.*rerun the failed publish job/);
  assert.equal(elapsed, 600_000);
  assert.equal(reads, 31);
});
