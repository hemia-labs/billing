import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { SystemContextCache } from '@hemia/auth';
import { REDIS, RedisSessionStore } from '../auth/redis-session-store';
import type { InvalidationTarget } from './billing-access-event.contracts';

@Injectable()
export class BillingSessionInvalidationService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly store: RedisSessionStore,
  ) {}
  async invalidate(target: InvalidationTarget): Promise<void> {
    await new SystemContextCache(this.store).invalidate({
      organizationId: target.organizationId,
      ...(target.kind === 'identity'
        ? { issuer: target.issuer, subject: target.subjectId }
        : {}),
    });
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        'sso:session:*',
        'COUNT',
        100,
      );
      cursor = next;
      if (!keys.length) continue;
      const values = await this.redis.mget(...keys);
      for (let index = 0; index < keys.length; index++) {
        if (!matchesSession(values[index], target)) continue;
        const key = keys[index];
        // Same key/TTL as @hemia/auth refresh and logout: a refresh that
        // started earlier must finish before we reread and invalidate the session.
        await this.store.withLock(
          `sso:refresh:${key.slice('sso:session:'.length)}`,
          30,
          async () => {
            if (matchesSession(await this.redis.get(key), target))
              await this.store.delete(key);
          },
        );
      }
    } while (cursor !== '0');
  }
}

export function matchesSession(
  raw: string | null,
  target: InvalidationTarget,
): boolean {
  if (!raw) return false;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') return false;
  const context = (
    value as {
      accessContext?: {
        identity?: { issuer?: string; subject_id?: string };
        organizations?: Array<{
          organization_id?: string;
          context_version?: number;
        }>;
      };
    }
  ).accessContext;
  const organization = context?.organizations?.find(
    (item) => item.organization_id === target.organizationId,
  );
  if (target.kind === 'organization') return Boolean(organization);
  if (
    context?.identity?.issuer !== target.issuer ||
    context.identity.subject_id !== target.subjectId
  )
    return false;
  // A context resolved at/after this revision need not be discarded again.
  return !(
    organization &&
    target.contextVersion !== undefined &&
    typeof organization.context_version === 'number' &&
    organization.context_version >= target.contextVersion
  );
}
