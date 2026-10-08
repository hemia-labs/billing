import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import type { BillingAuditRecordInput } from '../src/modules/audit/types';
import {
  BillingAuditLogEntity,
  BillingProvider,
  BillingWebhookEventEntity,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '../src/modules/billing-shared';
import { BillingWebhooksController } from '../src/modules/webhooks/billing-webhooks.controller';
import { BillingWebhooksService } from '../src/modules/webhooks/billing-webhooks.service';

function fixture() {
  const payload: Record<string, unknown> = {
    id: 'WH-EVENT',
    event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
    resource: { id: 'I-SUBSCRIPTION', status: 'ACTIVE' },
  };
  const state = {
    event: null as BillingWebhookEventEntity | null,
    notifications: [] as string[],
  };
  const events = {
    findOne: jest.fn(
      ({ where }: { where: { id?: string; providerEventId?: string } }) => {
        const event = state.event;
        return Promise.resolve(
          event &&
            (event.id === where.id ||
              event.providerEventId === where.providerEventId)
            ? structuredClone(event)
            : null,
        );
      },
    ),
    create: jest.fn((input: Partial<BillingWebhookEventEntity>) =>
      Object.assign(new BillingWebhookEventEntity(), {
        id: 'stored-event',
        ...input,
      }),
    ),
    save: jest.fn((event: BillingWebhookEventEntity) => {
      state.event = structuredClone(event);
      return Promise.resolve(structuredClone(event));
    }),
  };
  const auditLogs = { count: jest.fn(() => Promise.resolve(0)) };
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === BillingWebhookEventEntity) return events;
      if (entity === BillingAuditLogEntity) return auditLogs;
      throw new Error('Unexpected repository');
    },
    query: jest.fn((sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO webhook_events')) {
        if (state.event) return Promise.resolve([]);
        const [
          provider,
          providerEventId,
          eventType,
          resourceId,
          transmissionId,
          verificationStatus,
          processingStatus,
          payloadJson,
          errorMessage,
        ] = params;
        state.event = Object.assign(new BillingWebhookEventEntity(), {
          id: 'stored-event',
          provider,
          providerEventId,
          eventType,
          resourceId,
          transmissionId,
          verificationStatus,
          processingStatus,
          payloadJson:
            typeof payloadJson === 'string'
              ? (JSON.parse(payloadJson) as unknown as Record<string, unknown>)
              : payloadJson,
          errorMessage: errorMessage ?? null,
          attempts: 0,
          nextRetryAt: new Date(),
          lockedUntil: null,
          leaseToken: null,
          requiresManualReview: false,
          receivedAt: new Date(),
          processedAt: errorMessage ? new Date() : null,
        });
        return Promise.resolve([{ id: 'stored-event' }]);
      }
      if (sql.includes('pg_notify')) {
        state.notifications.push(String(params[1]));
        return Promise.resolve([]);
      }
      if (sql.includes('organization_id'))
        return Promise.resolve([{ organization_id: 'organization' }]);
      return Promise.resolve([]);
    }),
  };
  async function transaction<T>(callback: (manager: never) => Promise<T>) {
    const previous = structuredClone(state);
    try {
      return await callback(manager as never);
    } catch (error) {
      Object.assign(state, previous);
      throw error;
    }
  }
  const dataSource = { transaction };
  const paypal = {
    verifyWebhook: jest.fn(() => Promise.resolve({ verified: true })),
  };
  const audit = {
    record: jest.fn<Promise<void>, [BillingAuditRecordInput]>(() =>
      Promise.resolve(),
    ),
  };
  const service = new BillingWebhooksService(
    dataSource as never,
    paypal as never,
    audit as never,
    events as never,
    auditLogs as never,
  );
  const seed = (
    status = WebhookProcessingStatus.Failed,
    note = 'PayPal unavailable',
    verificationStatus = WebhookVerificationStatus.Verified,
  ) => {
    state.event = events.create({
      provider: BillingProvider.Paypal,
      providerEventId: 'WH-EVENT',
      eventType: String(payload.event_type),
      resourceId: 'I-SUBSCRIPTION',
      payloadJson: structuredClone(payload),
      verificationStatus,
      processingStatus: status,
      attempts: 4,
      nextRetryAt: new Date(Date.now() - 10_000),
      lockedUntil: null,
      leaseToken: null,
      requiresManualReview: status === WebhookProcessingStatus.Failed,
      receivedAt: new Date(),
      processedAt: new Date(),
      errorMessage: note,
    });
  };
  return {
    payload,
    state,
    events,
    manager,
    paypal,
    audit,
    auditLogs,
    service,
    seed,
  };
}

describe('PayPal webhook durable receipt', () => {
  let app: INestApplication;
  let f: ReturnType<typeof fixture>;
  const send = () =>
    request(app.getHttpServer() as Server)
      .post('/api/v1/billing/webhooks/paypal')
      .set({
        'paypal-transmission-id': 'transmission',
        'paypal-transmission-time': new Date().toISOString(),
        'paypal-cert-url': 'https://paypal.test/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-sig': 'signature',
      })
      .send(f.payload);

  beforeEach(async () => {
    f = fixture();
    const module = await Test.createTestingModule({
      controllers: [BillingWebhooksController],
      providers: [{ provide: BillingWebhooksService, useValue: f.service }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => app.close());

  it('verifies, durably stores, notifies in the transaction, and immediately acknowledges', async () => {
    await send().expect(200).expect({
      eventId: 'stored-event',
      providerEventId: 'WH-EVENT',
      processingStatus: 'pending',
      duplicate: false,
    });
    expect(f.state.event).toMatchObject({
      verificationStatus: WebhookVerificationStatus.Verified,
      processingStatus: WebhookProcessingStatus.Pending,
      attempts: 0,
    });
    expect(f.state.notifications).toEqual(['stored-event']);
    expect(f.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT(provider_event_id) DO NOTHING'),
      expect.any(Array),
    );
  });

  it('deduplicates a verified event without resetting its attempts or retry time', async () => {
    f.seed(WebhookProcessingStatus.Pending, 'temporary error');
    const retryAt = new Date(Date.now() - 60_000);
    f.state.event!.attempts = 8;
    f.state.event!.nextRetryAt = retryAt;
    await send().expect(200).expect({
      eventId: 'stored-event',
      providerEventId: 'WH-EVENT',
      processingStatus: 'pending',
      duplicate: true,
    });
    expect(f.state.event?.attempts).toBe(8);
    expect(f.state.event?.nextRetryAt).toEqual(retryAt);
    expect(f.state.notifications).toEqual(['stored-event']);
  });

  it('rejects an invalid signature and accepts the same event after valid verification', async () => {
    f.paypal.verifyWebhook.mockResolvedValueOnce({ verified: false });
    await send().expect(403);
    expect(f.state.event).toMatchObject({
      verificationStatus: WebhookVerificationStatus.Failed,
      processingStatus: WebhookProcessingStatus.Failed,
    });
    expect(f.state.notifications).toEqual([]);

    await send().expect(200);
    expect(f.state.event).toMatchObject({
      verificationStatus: WebhookVerificationStatus.Verified,
      processingStatus: WebhookProcessingStatus.Pending,
    });
    expect(f.state.notifications).toEqual(['stored-event']);
  });

  it('returns a retryable response when PayPal signature verification is unavailable', async () => {
    f.paypal.verifyWebhook.mockRejectedValueOnce(new Error('provider down'));
    await send().expect(503);
    expect(f.state.event).toBeNull();
  });

  it('does not overwrite an already verified event after an invalid duplicate', async () => {
    f.seed();
    const original = structuredClone(f.state.event);
    f.payload.resource = { id: 'untrusted-resource' };
    f.paypal.verifyWebhook.mockResolvedValueOnce({ verified: false });
    await send().expect(403);
    expect(f.state.event).toEqual(original);
  });

  it('queues an authorized manual retry and keeps its audit record', async () => {
    f.seed();
    const result = await f.service.retryWebhook(
      'stored-event',
      'Provider recovered',
      'operator',
      null,
    );
    expect(result.processingStatus).toBe(WebhookProcessingStatus.Pending);
    expect(f.state.event).toMatchObject({
      processingStatus: WebhookProcessingStatus.Pending,
      attempts: 0,
      requiresManualReview: false,
    });
    expect(f.state.notifications).toEqual(['stored-event']);
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.webhook.manual_retry',
        actorUserId: 'operator',
        manager: f.manager,
      }),
    );
  });

  it('retains the manual retry rate limit', async () => {
    f.seed();
    f.auditLogs.count.mockResolvedValueOnce(3);
    await expect(
      f.service.retryWebhook('stored-event', 'retry', 'operator', null),
    ).rejects.toMatchObject({ status: 429 });
    expect(f.state.notifications).toEqual([]);
    expect(f.state.event?.processingStatus).toBe(
      WebhookProcessingStatus.Failed,
    );
  });
});
