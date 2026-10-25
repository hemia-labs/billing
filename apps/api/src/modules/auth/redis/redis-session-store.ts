import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SessionStore } from '@hemia/auth';
import type Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

@Injectable()
export class RedisSessionStore implements SessionStore, OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value === null ? null : (JSON.parse(value) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async withLock<T>(
    key: string,
    ttlSeconds: number,
    callback: () => Promise<T>,
  ): Promise<T> {
    const token = randomUUID();
    const deadline = Date.now() + Math.max(ttlSeconds * 1000 + 5_000, 10_000);

    while (
      (await this.redis.set(key, token, 'EX', ttlSeconds, 'NX')) !== 'OK'
    ) {
      if (Date.now() >= deadline) throw new Error(`Redis lock timeout: ${key}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    try {
      return await callback();
    } finally {
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        token,
      );
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
