const assert = require('node:assert/strict');
const Redis = require('ioredis');
const { SystemContextCache } = require('@hemia/auth');
const { RedisSessionStore } = require('../dist/src/modules/auth/redis-session-store');
(async () => {
  const clients = [new Redis(Number(process.env.CONTEXT_TEST_REDIS_PORT), '127.0.0.1'), new Redis(Number(process.env.CONTEXT_TEST_REDIS_PORT), '127.0.0.1')];
  try {
    const stores = clients.map(client => new RedisSessionStore(client));
    const caches = stores.map(store => new SystemContextCache(store));
    const scope = { sessionId: 'redis-test', issuer: 'id', subject: 'ana', organizationId: 'hemia', membershipId: 'm', product: 'billing', audience: 'billing-api' };
    await stores[0].set('sso:session:redis-test', {}, 120);
    let calls = 0;
    const load = async () => { calls++; await new Promise(r => setTimeout(r, 30)); const now = Math.floor(Date.now()/1000); return { iat: now, exp: now + 300 }; };
    await Promise.all(Array.from({length: 20}, (_, i) => caches[i%2].resolve(scope, false, load)));
    assert.equal(calls, 1, 'one resolution for concurrent readers across Redis connections');
    const keys = await clients[0].keys('sso:system-context:value:*');
    assert.equal(keys.length, 1);
    assert.ok(await clients[0].ttl(keys[0]) <= 60);
    await caches[1].invalidate({organizationId: 'hemia'});
    await caches[0].resolve(scope, false, load);
    assert.equal(calls, 2);
    await assert.rejects(caches[0].resolve(scope, true, async () => {
      await caches[1].invalidate({organizationId: 'hemia', issuer: 'id', subject: 'ana'});
      return load();
    }), /Authorization changed/);
    const entry = JSON.parse(await clients[0].get(keys[0]) || 'null');
    assert.equal(entry, null, 'invalidated in-flight result must not refill');
    await caches[0].resolve(scope, false, load);
    await stores[1].delete('sso:session:redis-test');
    await assert.rejects(caches[0].resolve(scope, false, load), /Session/);
    console.log('PASS: Redis distributed readers, TTL, cross-instance invalidation, in-flight fencing and logout');
  } finally { await Promise.all(clients.map(client => client.quit())); }
})().catch(error => { console.error(error); process.exitCode = 1; });
