import { envVarsSchema } from '../../../../apps/api/src/config/env.validation';
import { EventBus, type EventEnvelope } from '@hemia/event-bus';
import { BillingEventBusConsumer } from '../../../../apps/api/src/modules/event-bus/transport/billing-event-bus.consumer';
import {
  BillingSessionInvalidationService,
  matchesSession,
} from '../../../../apps/api/src/modules/event-bus/billing-session-invalidation.service';
import { invalidationTarget } from '../../../../apps/api/src/modules/event-bus/transport/billing-access-event.contracts';

const identity = { issuer: 'issuer', subject_id: 'ana' };
const session = (version = 2, issuer = 'issuer') =>
  JSON.stringify({
    accessContext: {
      identity: { ...identity, issuer },
      organizations: [{ organization_id: 'org', context_version: version }],
    },
  });
const target = {
  kind: 'identity' as const,
  issuer: 'issuer',
  subjectId: 'ana',
  organizationId: 'org',
  contextVersion: 3,
};
const data = {
  organization_id: 'org',
  membership_id: 'membership',
  identity_reference_id: 'reference',
  identity_issuer: 'issuer',
  subject_id: 'ana',
  context_version: 3,
  reason: 'authorization_changed',
};
const event = {
  id: 'event-id',
  source: 'urn:hemia:service:hemia-access',
  type: 'access.membership.context_invalidated.v1',
  data,
} as unknown as EventEnvelope<unknown>;

describe('Billing Access invalidations', () => {
  it('requires a broker URL when events are enabled and bounds prefetch', () => {
    expect(
      envVarsSchema.validate({ EVENT_BUS_ENABLED: true }).error?.message,
    ).toContain('AMQP_URL');
    expect(
      envVarsSchema.validate({
        EVENT_BUS_ENABLED: true,
        AMQP_URL: 'amqp://localhost',
        EVENT_BUS_PREFETCH: 0,
      }).error?.message,
    ).toContain('EVENT_BUS_PREFETCH');
  });
  it('uses issuer and subject, never subject alone', () => {
    expect(matchesSession(session(), target)).toBe(true);
    expect(matchesSession(session(2, 'another-issuer'), target)).toBe(false);
  });
  it('keeps sessions already resolved at the received version', () => {
    expect(matchesSession(session(3), target)).toBe(false);
    expect(matchesSession(session(4), target)).toBe(false);
  });
  it('invalidates organization sessions without tenant IDs', () => {
    expect(
      matchesSession(session(), {
        kind: 'organization',
        organizationId: 'org',
      }),
    ).toBe(true);
    expect(
      matchesSession(session(), {
        kind: 'organization',
        organizationId: 'other',
      }),
    ).toBe(false);
  });
  it('ignores product events belonging to Legal', () => {
    expect(
      invalidationTarget('access.organization_product.disabled.v1', {
        organization_id: 'org',
        product_code: 'legal',
      }),
    ).toBeNull();
  });
  it('rejects malformed identity, versions, unknown events and contradictory eligibility', () => {
    expect(() =>
      invalidationTarget(event.type, { ...data, identity_issuer: '' }),
    ).toThrow();
    expect(() =>
      invalidationTarget(event.type, { ...data, context_version: -1 }),
    ).toThrow();
    expect(() =>
      invalidationTarget('access.system_role.revoked.v1', data),
    ).toThrow();
    expect(() =>
      invalidationTarget('access.organization.eligibility_changed.v1', {
        organization_id: 'org',
        type: 'customer',
        previous_type: 'internal',
        organization_version: 3,
        eligible_internal: true,
      }),
    ).toThrow();
  });
  it('retries duplicate deliveries after a Redis failure', async () => {
    const invalidate = jest
      .fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValue(undefined);
    const consumer = new BillingEventBusConsumer(
      { get: jest.fn() } as never,
      { invalidate } as never,
    );
    await expect(consumer.consume(event)).rejects.toThrow('redis down');
    await expect(consumer.consume(event)).resolves.toBeUndefined();
    expect(invalidate).toHaveBeenCalledTimes(2);
    await expect(
      consumer.consume({ ...event, source: 'another-service' }),
    ).rejects.toThrow();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it('rereads under the SDK refresh lock before deleting', async () => {
    let locked = false;
    const redis = {
      scan: jest.fn().mockResolvedValue(['0', ['sso:session:one']]),
      mget: jest.fn().mockResolvedValue([session()]),
      get: jest.fn(() => {
        expect(locked).toBe(true);
        return Promise.resolve(session(3));
      }),
    };
    const store = {
      set: jest.fn(),
      withLock: jest.fn(
        async (_key: string, _ttl: number, callback: () => Promise<void>) => {
          locked = true;
          await callback();
          locked = false;
        },
      ),
      delete: jest.fn(),
    };
    const invalidator = new BillingSessionInvalidationService(
      redis as never,
      store as never,
    );
    await invalidator.invalidate(target);
    expect(store.withLock).toHaveBeenCalledWith(
      'sso:refresh:one',
      30,
      expect.any(Function),
    );
    expect(store.delete).not.toHaveBeenCalled();
    redis.get.mockImplementation(() => Promise.resolve(session()));
    await invalidator.invalidate(target);
    expect(store.delete).toHaveBeenCalledWith('sso:session:one');
  });
  it('subscribes to its own queue and awaits invalidation before completing', async () => {
    const bus = { subscribe: jest.fn(), close: jest.fn() };
    const connect = jest
      .spyOn(EventBus, 'connect')
      .mockResolvedValue(bus as never);
    const config = {
      get: (key: string) => (key === 'eventBus.enabled' ? true : 10),
      getOrThrow: () => 'amqp://localhost',
    };
    const consumer = new BillingEventBusConsumer(
      config as never,
      { invalidate: jest.fn() } as never,
    );
    try {
      await consumer.onModuleInit();
      expect(bus.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({ queue: 'hemia-billing.access' }),
        expect.any(Function),
        { prefetch: 10 },
      );
      await consumer.onModuleDestroy();
      expect(bus.close).toHaveBeenCalled();
    } finally {
      connect.mockRestore();
    }
  });
});
