import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'bun:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const load = name => Bun.YAML.parse(readFileSync(`${root}.github/workflows/${name}.yml`, 'utf8'));

// GitHub replaces workflow permissions when a job declares its own map.
function permissions(workflow, job) {
  const value = job.permissions ?? workflow.permissions ?? {};
  if (value === 'read-all') return { contents: 'read', '*': 'read' };
  if (value === 'write-all') return { contents: 'write', '*': 'write' };
  assert.equal(typeof value, 'object', 'Expected a permissions map');
  return value;
}

function readOnly(workflow) {
  assert(!Object.hasOwn(workflow.on, 'pull_request_target'));
  assert(!Object.hasOwn(workflow.on, 'workflow_run'));
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const effective = permissions(workflow, job);
    assert.equal(effective.contents, 'read', `${name} needs read access`);
    assert(Object.values(effective).every(value => ['read', 'none'].includes(value)), `${name} must be read-only`);
    assert.equal(job.environment, undefined, `${name} cannot use a production environment`);
    assert.equal(job.secrets, undefined, `${name} cannot inherit secrets`);
  }
}

function scopedPermissions(workflow, overrides) {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.deepEqual(permissions(workflow, job), overrides[name] ?? { contents: 'read' }, `${name}: unexpected token permissions`);
  }
}

const needs = job => [job.needs].flat().sort();
const expression = value => {
  assert.equal(typeof value, 'string');
  return value.replace(/^\$\{\{\s*|\s*\}\}$/g, '').replace(/\s+/g, '');
};

function releaseGates(workflow) {
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert(!Object.hasOwn(workflow.on, 'pull_request'));
  assert(!Object.hasOwn(workflow.on, 'pull_request_target'));
  assert(!Object.hasOwn(workflow.on, 'workflow_run'));
  const { classify, checks, 'version-pr': version, publish, 'auto-deploy': deploy } = workflow.jobs;
  assert.equal(expression(classify.if), "github.repository=='hemia-labs/billing'&&github.ref=='refs/heads/main'");
  assert.equal(checks.uses, './.github/workflows/billing-ci.yml');
  assert.deepEqual(needs(checks), ['classify']);
  assert.deepEqual(needs(version), ['checks', 'classify']);
  assert.equal(expression(version.if), "needs.classify.outputs.release!='true'");
  const pr = version.steps.find(step => step.uses?.startsWith('peter-evans/create-pull-request@'));
  assert.equal(pr.with.base, 'main');
  assert.equal(pr.with.branch, 'changeset-release/billing');
  assert.deepEqual(needs(publish), ['checks', 'classify']);
  assert.equal(expression(publish.if), "!cancelled()&&needs.classify.result=='success'&&needs.classify.outputs.release=='true'");
  assert.equal(publish.environment, 'prod');
  assert(publish.steps.some(step => step.run?.trim() === 'bash scripts/billing-checks.sh'));
  assert.equal(deploy.uses, './.github/workflows/billing-deploy.yml');
  assert.deepEqual(needs(deploy), ['publish']);
  assert.equal(expression(deploy.if), "!cancelled()&&needs.publish.result=='success'");
  assert.deepEqual(deploy.with, {
    operation: 'deploy', release_tag: '${{ needs.publish.outputs.release_tag }}', automatic: true,
  });
  assert.equal(deploy.secrets, 'inherit');
}

for (const name of ['billing-ci', 'package-payments']) {
  test(`${name}: every CI job has effective read-only permissions and no production access`, () => readOnly(load(name)));
}

test('Billing CI exposes PR, development, reusable and manual entry points', () => {
  const workflow = load('billing-ci');
  assert.deepEqual(workflow.on.pull_request.branches, ['main', 'develop']);
  assert.deepEqual(workflow.on.push.branches, ['develop']);
  for (const event of ['workflow_call', 'workflow_dispatch']) assert(Object.hasOwn(workflow.on, event));
  assert(workflow.jobs.billing.steps.some(step => step.run?.trim() === 'bash scripts/billing-checks.sh'));
});

const unsafeCi = [
  ['job contents write over workflow read', w => { w.jobs.billing.permissions = { contents: 'write' }; }],
  ['job write-all', w => { w.jobs.billing.permissions = 'write-all'; }],
  ['inherited write-all', w => { w.permissions = 'write-all'; }],
  ['missing contents after job override', w => { w.jobs.billing.permissions = { checks: 'read' }; }],
  ['extra job with write access', w => { w.jobs.extra = { permissions: { contents: 'write' } }; }],
  ['production environment', w => { w.jobs.billing.environment = 'prod'; }],
  ['inherited secrets', w => { w.jobs.billing.secrets = 'inherit'; }],
];
for (const [name, mutate] of unsafeCi) {
  test(`regression: rejects ${name}`, () => {
    const workflow = load('billing-ci');
    mutate(workflow);
    const parsed = Bun.YAML.parse(Bun.YAML.stringify(workflow));
    assert.throws(() => readOnly(parsed));
  });
}

test('job read-only overrides workflow write-all instead of merging it', () => {
  const workflow = load('billing-ci');
  workflow.permissions = 'write-all';
  workflow.jobs.billing.permissions = { contents: 'read' };
  readOnly(workflow);
});

test('Billing release grants write/OIDC only to the designated jobs', () => {
  scopedPermissions(load('billing-release'), {
    'version-pr': { contents: 'write', 'pull-requests': 'write' },
    publish: { contents: 'write', 'id-token': 'write' },
    'auto-deploy': { contents: 'read', 'id-token': 'write' },
  });
});

test('Billing release connects reviewed versions, shared CI and successful publication to deployment', () => releaseGates(load('billing-release')));

test('regression: a publication condition bypass cannot be hidden behind safe-looking text', () => {
  const workflow = load('billing-release');
  workflow.jobs.publish.if = '${{ true }}';
  assert.throws(() => releaseGates(workflow));
});

test('Payments has its own publication prerequisites and narrowly scoped permissions', () => {
  const workflow = load('release-payments');
  assert.deepEqual(workflow.on.push.branches, ['main']);
  scopedPermissions(workflow, {
    'version-pr': { contents: 'write', 'pull-requests': 'write' },
    publish: { contents: 'write', 'id-token': 'write' },
  });
  assert.equal(workflow.jobs.validate.uses, './.github/workflows/package-payments.yml');
  assert.deepEqual(needs(workflow.jobs.publish), ['classify', 'validate']);
  assert.equal(expression(workflow.jobs.publish.if), "needs.classify.outputs.release=='true'&&vars.ENABLE_NPM_PUBLISH=='true'");
  assert.equal(workflow.jobs.publish.environment, 'npm');
});

test('deployment gates production access and keeps migrations explicitly selectable', () => {
  const workflow = load('billing-deploy');
  scopedPermissions(workflow, { deploy: { contents: 'read', 'id-token': 'write' } });
  assert.equal(workflow.on.workflow_call.inputs.automatic.default, false);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.operation.options, ['deploy', 'rollback', 'migrate']);
  assert.equal(workflow.on.workflow_dispatch.inputs.backup_confirmation.type, 'string');
  assert.equal(workflow.on.workflow_dispatch.inputs.release_tag.required, true);
  const { enabled, deploy } = workflow.jobs;
  assert.equal(enabled.environment, 'prod');
  assert.equal(expression(enabled.if), "github.repository=='hemia-labs/billing'&&github.ref=='refs/heads/main'");
  assert.equal(enabled.outputs.deploy, '${{ steps.check.outputs.deploy }}');
  const gate = enabled.steps.find(step => step.id === 'check');
  assert.equal(gate.env.ENABLE_DEPLOY, '${{ vars.ENABLE_BILLING_DEPLOY }}');
  assert.equal(deploy.environment, 'prod');
  assert.deepEqual(needs(deploy), ['enabled']);
  assert.equal(expression(deploy.if), "needs.enabled.outputs.deploy=='true'");
  const cleanup = deploy.steps.find(step => step.run?.trim() === 'rm -f -- "$DEPLOY_KEY_FILE" "$DEPLOY_KNOWN_HOSTS_FILE"');
  assert(cleanup, 'Missing SSH credential cleanup step');
  assert.equal(expression(cleanup.if), 'always()');
});

for (const name of ['billing-release', 'release-payments']) {
  test(`${name}: stale version updates are gated and real update failures remain fatal`, () => {
    const steps = load(name).jobs['version-pr'].steps;
    const check = steps.find(step => step.id === 'current-version');
    const update = steps.find(step => step.id === 'version-update');
    const recover = steps.find(step => step.run === 'node scripts/release-current.mjs recover');
    assert.equal(check.run, 'node scripts/release-current.mjs check');
    assert(steps.indexOf(check) < steps.indexOf(update));
    assert.equal(expression(update.if), "steps.changesets.outputs.pending=='true'&&steps.current-version.outputs.current=='true'");
    assert.equal(update['continue-on-error'], true);
    assert.equal(expression(recover.if), "steps.version-update.outcome=='failure'");
    assert.equal(recover['continue-on-error'], undefined);
    assert(steps.indexOf(recover) > steps.indexOf(update));
  });
}

test('Billing publication uses the recovery publisher after checks, with credentials scoped to the step', () => {
  const workflow = load('billing-release');
  const publish = workflow.jobs.publish.steps.find(step => step.name === 'Publish images and immutable release assets');
  assert(publish.run.includes('python3 scripts/billing-publish.py "$RELEASE_TAG" "$RUNNER_TEMP/billing-release"'));
  assert(publish.run.includes('docker login "$REGISTRY_HOST"'));
  assert(publish.run.includes('docker logout "$REGISTRY_HOST"'));
  assert.equal(publish.env.REGISTRY_PASSWORD, '${{ secrets.REGISTRY_PASSWORD }}');
});
