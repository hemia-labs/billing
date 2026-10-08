import type Redis from 'ioredis';
import { CopilotSessionsService } from '../../src/modules/copilot/copilot-sessions.service';

function storage() {
  const values = new Map<string, string>();
  const redis = {
    del: jest.fn((...keys: string[]) =>
      Promise.resolve(
        keys.reduce((count, key) => count + Number(values.delete(key)), 0),
      ),
    ),
    get: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      if (values.has(key)) return Promise.resolve(null);
      values.set(key, value);
      return Promise.resolve('OK');
    }),
    eval: jest.fn((_: string, count: number, ...args: (string | number)[]) => {
      const lock = String(args[0]);
      const token = String(args[count]);
      if (values.get(lock) !== token) return Promise.resolve(0);
      if (count === 1) values.delete(lock);
      else values.set(String(args[1]), String(args[3]));
      return Promise.resolve(1);
    }),
  };
  return {
    values,
    redis,
    service: new CopilotSessionsService(redis as unknown as Redis),
  };
}

describe('Copilot conversation storage', () => {
  it('deletes only the scoped conversation and prevents an active writer restoring it', async () => {
    const { service } = storage();
    const first = await service.acquire(['owner-a'], 'session');
    await first.commit(first.session);
    const other = await service.acquire(['owner-b'], 'session');
    await other.commit(other.session);
    await other.release();
    await service.delete(['owner-a'], 'session');
    await expect(first.commit(first.session)).rejects.toThrow(
      'conversación cambió',
    );
    await first.release();
    await service.delete(['owner-a'], 'session');
    const deleted = await service.acquire(['owner-a'], 'session');
    expect(deleted.expired).toBe(true);
    await deleted.release();
    const preserved = await service.acquire(['owner-b'], 'session');
    expect(preserved.expired).toBe(false);
    await preserved.release();
  });
  it('retains more than six exchanges across service instances and isolates owners and tasks', async () => {
    const { redis, service } = storage();
    const scope = ['user-a', 'org-a', 'product-draft', 'new'];
    const initial = await service.acquire(scope, 'session-a');
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? ('assistant' as const) : ('user' as const),
      content: `message-${index}`,
    }));
    await initial.commit({ ...initial.session, history });
    expect(redis.eval.mock.calls.find((call) => call[1] === 2)?.at(-1)).toBe(
      3600,
    );
    await initial.release();
    const anotherInstance = new CopilotSessionsService(
      redis as unknown as Redis,
    );
    const resumed = await anotherInstance.acquire(scope, 'session-a');
    expect(resumed.session.history).toEqual(history);
    expect(resumed.expired).toBe(false);
    await resumed.release();
    for (const isolatedScope of [
      ['user-b', ...scope.slice(1)],
      ['user-a', 'org-b', ...scope.slice(2)],
      ['user-a', 'org-a', 'plan-draft', 'new'],
      ['user-a', 'org-a', 'product-draft', 'other'],
    ]) {
      const isolated = await service.acquire(isolatedScope, 'session-a');
      expect(isolated.session.history).toEqual([]);
      await isolated.release();
    }
  });

  it('rejects overlapping runs and stale commits without deleting the new lock', async () => {
    const { service, values } = storage();
    const active = await service.acquire(['owner'], 'session');
    await expect(service.acquire(['owner'], 'session')).rejects.toThrow(
      'respuesta en curso',
    );
    const lock = [...values.keys()].find((key) => key.endsWith(':lock'))!;
    values.set(lock, 'replacement');
    await expect(active.commit(active.session)).rejects.toThrow(
      'conversación cambió',
    );
    await active.release();
    expect(values.get(lock)).toBe('replacement');
  });

  it('rejects excessive context without trimming it and releases the lock on failure', async () => {
    const { service, values } = storage();
    const first = await service.acquire(['owner'], 'session');
    await first.commit({
      ...first.session,
      history: [{ role: 'user', content: 'a'.repeat(210 * 1024) }],
    });
    await first.release();
    await expect(service.acquire(['owner'], 'session')).rejects.toThrow(
      'CONTEXT_FULL',
    );
    expect([...values.keys()].filter((key) => key.endsWith(':lock'))).toEqual(
      [],
    );
  });
});
