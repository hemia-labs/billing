import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const billingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function localServices(env = process.env) {
  const identity = resolve(env.IDENTITY_ROOT || join(billingRoot, '../identity-access/identity'));
  const access = resolve(env.ACCESS_ROOT || join(billingRoot, '../identity-access/access'));
  return [
    { name: 'Identity API', cwd: identity, args: ['run', 'dev:api'], port: 4000, checks: [
      { url: 'http://localhost:4000/api/v1/health/ready', kind: 'health' },
      { url: 'http://localhost:4000/.well-known/openid-configuration', kind: 'issuer', value: 'http://localhost:4000' },
    ] },
    { name: 'Identity web', cwd: identity, args: ['run', '--cwd', 'frontend', 'dev', '--strictPort'], port: 5173, checks: [
      { url: 'http://localhost:5173/', kind: 'html', value: '<title>Hemia ID</title>' },
    ] },
    { name: 'Access API', cwd: access, args: ['run', 'dev:api'], port: 3019, checks: [
      { url: 'http://localhost:3019/health/ready', kind: 'health' },
      { url: 'http://localhost:3019/.well-known/jwks.json', kind: 'jwks' },
    ] },
    { name: 'Billing API', cwd: billingRoot, args: ['run', 'dev:api'], port: 3015, checks: [
      { url: 'http://localhost:3015/api/v1/health/ready', kind: 'health', value: 'billing' },
      { url: 'http://localhost:3015/api/v1', kind: 'text', value: 'Hello World!' },
    ] },
    { name: 'Billing web', cwd: billingRoot, args: ['run', 'dev:web'], port: 5175, checks: [
      { url: 'http://localhost:5175/', kind: 'html', value: '<title>Resumen operativo</title>' },
    ] },
  ];
}

export async function healthy(service) {
  try {
    for (const check of service.checks) {
      const response = await fetch(check.url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(2000) });
      if (!response.ok) return false;
      if (check.kind === 'text' || check.kind === 'html') {
        const body = await response.text();
        if (check.kind === 'text' ? body.trim() !== check.value : !body.includes(check.value)) return false;
        if (check.kind === 'html' && !response.headers.get('content-type')?.includes('text/html')) return false;
      } else {
        const body = await response.json();
        if (check.kind === 'health' && (body.status !== 'ok' || check.value !== undefined && body.service !== check.value)) return false;
        if (check.kind === 'issuer' && (body.issuer !== check.value || new URL(body.authorization_endpoint).origin !== check.value)) return false;
        if (check.kind === 'jwks' && (!Array.isArray(body.keys) || !body.keys.length)) return false;
      }
    }
    return true;
  } catch { return false; }
}

async function portInUse(port) {
  return new Promise((done) => {
    const socket = createConnection({ host: 'localhost', port });
    const finish = (used) => { socket.destroy(); done(used); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1500, () => finish(true));
  });
}

// Foreground supervisor: only signals the process groups created by this invocation.
export async function startStack(services, { timeoutMs = 90_000, log = console.log, signal } = {}) {
  const owned = [];
  let logs;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const send = (item, name) => {
      if (!item.child.pid) return;
      try {
        if (process.platform === 'win32') item.child.kill(name);
        else process.kill(-item.child.pid, name);
      } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    for (const item of owned) send(item, 'SIGTERM');
    await Promise.race([Promise.all(owned.map((item) => item.closed)), delay(3000)]);
    for (const item of owned) send(item, 'SIGKILL');
  };
  try {
    for (const service of services) {
      signal?.throwIfAborted();
      if (await healthy(service)) { log(`${service.name}: listo (se conserva la instancia existente).`); continue; }
      if (await portInUse(service.port)) throw new Error(`${service.name}: puerto ${service.port} ocupado, pero el servicio no está listo o no corresponde. No se detuvo ningún proceso ajeno.`);
      if (!existsSync(join(service.cwd, 'package.json'))) throw new Error(`${service.name}: falta el checkout en ${service.cwd}. Configura IDENTITY_ROOT/ACCESS_ROOT según corresponda.`);
      logs ??= mkdtempSync(join(tmpdir(), 'billing-dev-stack-'));
      const logfile = join(logs, service.name.toLowerCase().replaceAll(' ', '-') + '.log');
      const fd = openSync(logfile, 'w', 0o600);
      let child;
      try {
        child = spawn(service.command || 'bun', service.args, { cwd: service.cwd, env: { ...process.env, NODE_ENV: 'development' }, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd] });
      } finally { closeSync(fd); }
      const item = { child, failed: null, closed: null };
      item.closed = new Promise((done) => {
        child.once('error', () => { item.failed = new Error(`${service.name}: no se pudo ejecutar el comando. Revisa Bun y las dependencias.`); done(); });
        child.once('exit', () => { item.failed = new Error(`${service.name}: el proceso terminó. Revisa ${logfile}`); done(); });
      });
      owned.push(item);
      log(`${service.name}: iniciando; log ${logfile}`);
      const deadline = Date.now() + timeoutMs;
      while (!await healthy(service)) {
        signal?.throwIfAborted();
        if (item.failed) throw item.failed;
        if (Date.now() >= deadline) throw new Error(`${service.name}: no está listo. Revisa ${logfile}; no se ejecutan migraciones ni seeds automáticamente.`);
        await delay(400, undefined, { signal });
      }
      if (item.failed) throw item.failed;
      log(`${service.name}: listo.`);
    }
    log('Billing disponible en http://localhost:5175. Identity y Access comprobados.');
    return { stop, owned };
  } catch (error) { await stop(); throw error; }
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Uso: bun run dev:stack [--check]');
  const services = localServices();
  if (process.argv.includes('--check')) {
    let ready = true;
    for (const service of services) { const ok = await healthy(service); console.log(`${service.name}: ${ok ? 'listo' : 'no disponible o no listo'}`); ready &&= ok; }
    if (!ready) process.exitCode = 1;
    return;
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let running;
  try {
    running = await startStack(services, { signal: controller.signal });
    if (running.owned.length) {
      await Promise.race([
        ...running.owned.map(async (item) => { await item.closed; throw item.failed; }),
        new Promise((done) => { if (controller.signal.aborted) done(); else controller.signal.addEventListener('abort', done, { once: true }); }),
      ]);
    }
  } finally { if (running) await running.stop(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { if (error.name !== 'AbortError') { console.error(error.message); process.exitCode = 1; } });
}
