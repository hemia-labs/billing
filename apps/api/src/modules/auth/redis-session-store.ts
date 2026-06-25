import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
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

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
