import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthy, startStack } from '../../scripts/dev-stack.mjs';

const project = mkdtempSync(join(tmpdir(), 'billing-stack-test-'));
writeFileSync(join(project, 'package.json'), '{}');
after(() => rmSync(project, { recursive: true, force: true }));

async function server(handler) {
  const app = createServer(handler);
  await new Promise((done) => app.listen(0, 'localhost', done));
  return { port: app.address().port, close: () => new Promise((done) => { app.close(done); app.closeAllConnections(); }) };
}
function descriptor(port, kind = 'health', value) {
  return { name: 'Test API', cwd: project, command: process.execPath, args: [], port,
    checks: [{ url: `http://localhost:${port}/`, kind, value }] };
}
async function unusedPort() { const app = await server(() => {}); const port = app.port; await app.close(); return port; }
function childService(port, status = 'ok') {
  const file = join(project, `server-${port}.mjs`);
  writeFileSync(file, `import{createServer}from'node:http';createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({status:${JSON.stringify(status)}}))}).listen(${port},'localhost');`);
  return { ...descriptor(port), args: [file] };
}

// The readiness payload matters: a port or HTTP 200 alone cannot identify a dependency.
test('rejects wrong readiness, empty keys and foreign identity even with HTTP 200', async () => {
  let body = { status: 'pending_migrations' };
  const app = await server((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); });
  try {
    assert.equal(await healthy(descriptor(app.port)), false);
    body = { status: 'ok' }; assert.equal(await healthy(descriptor(app.port)), true);
    assert.equal(await healthy(descriptor(app.port, 'health', 'billing')), false);
    body = { status: 'ok', service: 'other' }; assert.equal(await healthy(descriptor(app.port, 'health', 'billing')), false);
    body = { status: 'ok', service: 'billing' }; assert.equal(await healthy(descriptor(app.port, 'health', 'billing')), true);
    body = { keys: [] }; assert.equal(await healthy(descriptor(app.port, 'jwks')), false);
    body = { keys: [{ kty: 'RSA' }] }; assert.equal(await healthy(descriptor(app.port, 'jwks')), true);
    body = { issuer: 'https://foreign.example', authorization_endpoint: 'https://foreign.example/oauth/authorize' };
    assert.equal(await healthy(descriptor(app.port, 'issuer', 'http://localhost:4000')), false);
    body = { issuer: 'http://localhost:4000', authorization_endpoint: 'http://localhost:4000/oauth/authorize' };
    assert.equal(await healthy(descriptor(app.port, 'issuer', 'http://localhost:4000')), true);
  } finally { await app.close(); }
});

test('reuses a healthy service without spawning or stopping it', async () => {
  const app = await server((_req, res) => res.end('{"status":"ok"}'));
  try {
    const run = await startStack([{ ...descriptor(app.port), command: '/nonexistent/bun' }], { log() {} });
    assert.equal(run.owned.length, 0);
    await run.stop();
    assert.equal(await healthy(descriptor(app.port)), true);
  } finally { await app.close(); }
});

test('occupied unhealthy port stops startup without killing its owner or launching later services', async () => {
  const app = await server((_req, res) => { res.statusCode = 503; res.end('not ready'); });
  const messages = [];
  try {
    await assert.rejects(startStack([descriptor(app.port), { ...descriptor(await unusedPort()), name: 'Billing later' }], { log: (message) => messages.push(message) }), /puerto .* ocupado/);
    assert.equal((await fetch(`http://localhost:${app.port}`)).status, 503);
    assert.equal(messages.some((message) => message.includes('Billing later')), false);
  } finally { await app.close(); }
});

test('starts missing service and cleanup only stops its own child, preserving reused service', async () => {
  const app = await server((_req, res) => res.end('{"status":"ok"}'));
  const child = childService(await unusedPort());
  let run;
  try {
    run = await startStack([descriptor(app.port), child], { timeoutMs: 5000, log() {} });
    assert.equal(run.owned.length, 1);
    assert.equal(await healthy(child), true);
    await run.stop();
    assert.equal(await healthy(child), false);
    assert.equal(await healthy(descriptor(app.port)), true);
    await run.stop(); // Ctrl+C and teardown must be idempotent.
  } finally { await run?.stop(); await app.close(); }
});

test('dependency timeout stops created process and does not start Billing', async () => {
  const dependency = childService(await unusedPort(), 'pending_migrations');
  const messages = [];
  await assert.rejects(startStack([dependency, { ...descriptor(await unusedPort()), name: 'Billing later' }], { timeoutMs: 150, log: (message) => messages.push(message) }), /no está listo/);
  assert.equal(await healthy(dependency), false);
  assert.equal(messages.some((message) => message.includes('Billing later')), false);
});

test('missing command reports failure without attempting to signal an undefined PID', async () => {
  await assert.rejects(startStack([{ ...descriptor(await unusedPort()), command: '/nonexistent/bun' }], { timeoutMs: 1000, log() {} }), /no se pudo ejecutar/);
});

test('aborting startup cleans up the child instead of leaving an orphan service', async () => {
  const dependency = childService(await unusedPort(), 'starting');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  try {
    await assert.rejects(startStack([dependency], { signal: controller.signal, timeoutMs: 5000, log() {} }), { name: 'AbortError' });
    assert.equal(await healthy(dependency), false);
  } finally { clearTimeout(timer); }
});
