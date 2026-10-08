import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Session } from '@fevex/core';
import type Redis from 'ioredis';
import { REDIS } from '../auth/redis-session-store';

const sessionTtl = 60 * 60;
const maxSessionBytes = 256 * 1024;

@Injectable()
export class CopilotSessionsService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(scope: string[], sessionId: string) {
    const hash = createHash('sha256')
      .update(JSON.stringify([...scope, sessionId]))
      .digest('hex');
    // Shared hash tag keeps the atomic commit compatible with Redis Cluster.
    return `billing:copilot:session:{${hash}}`;
  }

  async delete(scope: string[], sessionId: string) {
    const key = this.key(scope, sessionId);
    // Revoke the writer too, so an in-flight completion cannot restore deleted history.
    await this.redis.del(key, `${key}:lock`);
  }

  async read(scope: string[], sessionId: string): Promise<Session | null> {
    const stored = await this.redis.get(this.key(scope, sessionId));
    return stored ? (JSON.parse(stored) as Session) : null;
  }

  async acquire(scope: string[], sessionId: string) {
    const key = this.key(scope, sessionId);
    const lock = `${key}:lock`;
    const token = randomUUID();
    const acquired = await this.redis.set(lock, token, 'EX', 150, 'NX');
    if (!acquired)
      throw new ConflictException(
        'Esta conversación ya tiene una respuesta en curso.',
      );
    const release = async () => {
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0",
        1,
        lock,
        token,
      );
    };
    try {
      const stored = await this.redis.get(key);
      // Leave space for the next complete turn. Never silently discard older messages.
      if (stored && Buffer.byteLength(stored) > 200 * 1024)
        throw new ConflictException('CONTEXT_FULL');
      const now = new Date().toISOString();
      const session: Session = stored
        ? (JSON.parse(stored) as Session)
        : { id: sessionId, history: [], createdAt: now, updatedAt: now };
      return {
        session,
        expired: !stored,
        release,
        commit: async (next: Session) => {
          const value = JSON.stringify(next);
          if (Buffer.byteLength(value) > maxSessionBytes)
            throw new ConflictException('CONTEXT_FULL');
          const committed = await this.redis.eval(
            "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3]); return 1",
            2,
            lock,
            key,
            token,
            value,
            sessionTtl,
          );
          if (committed !== 1)
            throw new ConflictException(
              'La conversación cambió durante la respuesta.',
            );
        },
      };
    } catch (error) {
      await release();
      throw error;
    }
  }
}
