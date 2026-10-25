import type { EventEmitter } from 'node:events';
import { Client } from 'pg';
import type { BillingAuditRecordInput } from '../../../../apps/api/src/modules/audit/types';
import {
  BillingProvider,
  WebhookProcessingStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import { BillingSubscriptionPaymentsProcessorService } from '../../../../apps/api/src/modules/webhooks/paypal/billing-subscription-payments-processor.service';
import { PaypalWebhookWorker } from '../../../../apps/api/src/modules/webhooks/paypal/paypal-webhook-worker';

jest.mock('pg', () => {
  const { EventEmitter } =
    jest.requireActual<typeof import('node:events')>('node:events');
  return {
    Client: jest.fn().mockImplementation(() => {
      const client = new EventEmitter() as MockPgClient;
      client.connect = jest.fn(() => Promise.resolve());
      client.query = jest.fn<Promise<{ rows: [] }>, [string]>(() =>
        Promise.resolve({ rows: [] }),
      );
      client.end = jest.fn(() => Promise.resolve());
      return client;
    }),
  };
});

type MockPgClient = EventEmitter & {
  connect: jest.Mock<Promise<void>, []>;
  query: jest.Mock<Promise<{ rows: [] }>, [string]>;
  end: jest.Mock<Promise<void>, []>;
};

function fixture() {
  const job = {
    id: 'event-id',
    provider_event_id: 'WH-1',
    event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
    payload_json: { resource: { id: 'I-SUB' } },
    attempts: 1,
    lease_token: 'lease-1',
  };
  const manager = {
    query: jest.fn<
      Promise<Array<Record<string, unknown>>>,
      [string, unknown[]?]
    >((sql) => {
      if (sql.includes('SELECT id FROM webhook_events'))
        return Promise.resolve([{ id: job.id }]);
      if (sql.includes('RETURNING id'))
        return Promise.resolve([{ id: job.id }]);
      return Promise.resolve([]);
    }),
  };
  const queryRunner = {
    query: jest.fn(
      async (sql: string, params: unknown[], structured: boolean) => {
        const rows = await manager.query(sql, params);
        // PostgreSQL UPDATE raw results are [rows, rowCount], including empty rows.
        return structured ? { records: rows } : [rows, rows.length];
      },
    ),
  };
  Object.assign(manager, { queryRunner });
  const dataSource = {
    options: { type: 'postgres' },
    transaction: jest.fn((callback: (manager: never) => Promise<unknown>) =>
      callback(manager as never),
    ),
    query: jest.fn<
      Promise<Array<{ delay_ms: number | null }>>,
      [string, unknown[]?]
    >(() => Promise.resolve([])),
  };
  const processor = {
    prepare: jest.fn(() =>
      Promise.resolve({ paypalSubscription: { id: 'I-SUB' } }),
    ),
    process: jest.fn(() =>
      Promise.resolve({ processingStatus: WebhookProcessingStatus.Processed }),
    ),
  };
  const audit = {
    record: jest.fn<Promise<void>, [BillingAuditRecordInput]>(() =>
      Promise.resolve(),
    ),
  };
  const worker = new PaypalWebhookWorker(
    dataSource as never,
    processor as unknown as BillingSubscriptionPaymentsProcessorService,
    audit as never,
  );
  return { job, manager, queryRunner, dataSource, processor, audit, worker };
}

describe('PayPal webhook worker', () => {
  beforeEach(() => {
    (Client as unknown as jest.Mock).mockClear();
  });

  it('claims one due event with SKIP LOCKED, a lease, and an incremented attempt', async () => {
    const f = fixture();
    f.manager.query.mockImplementationOnce(() => Promise.resolve([f.job]));
    const claimed = await f.worker['claim']();
    expect(claimed).toEqual(f.job);
    expect(f.manager.query.mock.calls[0][0]).toContain(
      'FOR UPDATE SKIP LOCKED',
    );
    expect(f.manager.query.mock.calls[0][0]).toContain('attempts=attempts+1');
    expect(f.manager.query.mock.calls[0][0]).toContain("'processing'");
  });

  it('returns no job when an UPDATE claims zero rows', async () => {
    const f = fixture();
    expect(await f.worker['claim']()).toBeNull();
    expect(f.queryRunner.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      true,
    );
    expect(f.processor.prepare).not.toHaveBeenCalled();
  });

  it('rejects a financial finalization that updates zero rows', async () => {
    const f = fixture();
    f.manager.query
      .mockResolvedValueOnce([{ id: f.job.id }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await f.worker['processJob'](f.job);
    expect(f.manager.query.mock.calls.at(-1)?.[1]).toContain(
      'PayPal webhook lease was lost',
    );
  });

  it('fetches the current PayPal state before its fenced financial transaction', async () => {
    const f = fixture();
    await f.worker['processJob'](f.job);
    expect(f.processor.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      f.dataSource.transaction.mock.invocationCallOrder[0],
    );
    expect(f.processor.process).toHaveBeenCalledWith(
      f.manager,
      expect.objectContaining({
        eventId: f.job.id,
        providerEventId: f.job.provider_event_id,
        eventType: f.job.event_type,
      }),
      { paypalSubscription: { id: 'I-SUB' } },
    );
    expect(f.manager.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(f.manager.query.mock.calls.at(-1)?.[0]).toContain(
      'processed_at=clock_timestamp()',
    );
  });

  it('does not process or write when the lease token is stale', async () => {
    const f = fixture();
    f.manager.query.mockResolvedValueOnce([]);
    await f.worker['processJob'](f.job);
    expect(f.processor.process).not.toHaveBeenCalled();
    expect(f.manager.query).toHaveBeenCalledTimes(1);
  });

  it('schedules exponential retries and clears the current lease', async () => {
    const f = fixture();
    f.job.attempts = 4;
    f.processor.process.mockRejectedValueOnce(new Error('PayPal unavailable'));
    await f.worker['processJob'](f.job);
    const failureQuery = f.manager.query.mock.calls.at(-1)?.[0] ?? '';
    const failureParams = f.manager.query.mock.calls.at(-1)?.[1] as unknown[];
    expect(failureQuery).toContain('next_retry_at=CASE');
    expect(failureQuery).toContain('lease_token=NULL,locked_until=NULL');
    expect(failureParams).toContain(WebhookProcessingStatus.Pending);
    expect(failureParams).toContain(false);
    expect(failureParams).toContain(40);
  });

  it('moves the fifteenth failed attempt to manual review and audits it', async () => {
    const f = fixture();
    f.job.attempts = 15;
    f.processor.prepare.mockRejectedValueOnce(new Error('PayPal unavailable'));
    await f.worker['processJob'](f.job);
    expect(f.manager.query.mock.calls.at(-1)?.[1]).toEqual([
      f.job.id,
      f.job.lease_token,
      WebhookProcessingStatus.Failed,
      'PayPal unavailable',
      true,
      3_600,
    ]);
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.webhook.manual_review_required',
        provider: BillingProvider.Paypal,
        resourceId: f.job.id,
      }),
    );
  });

  it('renews only the event lease owned by the same worker', async () => {
    const f = fixture();
    await f.worker['renew'](f.job);
    expect(f.dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('locked_until=clock_timestamp()'),
      [f.job.id, f.job.lease_token, 90],
    );
  });

  it('listens before draining, stays idle without polling, recovers by cron, and reconnects', async () => {
    jest.useFakeTimers();
    const f = fixture();
    try {
      f.worker.onApplicationBootstrap();
      await f.worker['connecting'];
      await f.worker['running'];

      const clients = (Client as unknown as jest.Mock).mock.results.map(
        (result) => result.value as MockPgClient,
      );
      expect(clients).toHaveLength(1);
      expect(clients[0].query).toHaveBeenCalledWith(
        'LISTEN billing_paypal_webhooks',
      );
      const claims = () =>
        f.manager.query.mock.calls.filter(([sql]) =>
          sql.includes('WITH candidate AS'),
        ).length;
      expect(claims()).toBe(1);

      clients[0].emit('notification', {
        channel: 'billing_paypal_webhooks',
        payload: f.job.id,
      });
      await f.worker['running'];
      expect(claims()).toBe(2);

      await jest.advanceTimersByTimeAsync(2_000);
      await f.worker['running'];
      expect(claims()).toBe(2);
      f.worker.recover();
      await f.worker['running'];
      expect(claims()).toBe(3);

      clients[0].emit('error', new Error('listener disconnected'));
      await jest.advanceTimersByTimeAsync(1_000);
      await f.worker['connecting'];
      await f.worker['running'];
      const reconnected = (Client as unknown as jest.Mock).mock.results.map(
        (result) => result.value as MockPgClient,
      );
      expect(reconnected).toHaveLength(2);
      expect(reconnected[1].query).toHaveBeenCalledWith(
        'LISTEN billing_paypal_webhooks',
      );
    } finally {
      await f.worker.onApplicationShutdown();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('wakes at the next durable retry time without querying while waiting', async () => {
    jest.useFakeTimers();
    const f = fixture();
    try {
      f.dataSource.query.mockResolvedValueOnce([{ delay_ms: 5_000 }]);
      await f.worker['scheduleNextAttempt']();
      await jest.advanceTimersByTimeAsync(4_999);
      expect(f.manager.query).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await f.worker['running'];
      expect(f.manager.query).toHaveBeenCalledTimes(1);
    } finally {
      await f.worker.onApplicationShutdown();
      jest.useRealTimers();
    }
  });
});
