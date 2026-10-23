import { Client } from 'pg';
import type { EventEmitter } from 'node:events';
import { BillingQueueWakeup } from '../../../../apps/api/src/modules/webhooks/billing-queue-wakeup';
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

it('listens before draining, stays idle, wakes by notification, retry and recovery, and reconnects', async () => {
  jest.useFakeTimers();
  const processPending = jest.fn(() => Promise.resolve());
  const query = jest.fn(() =>
    Promise.resolve([{ delay_ms: null as number | null }]),
  );
  const worker = new BillingQueueWakeup(
    { options: {}, query } as never,
    'billing_test_queue',
    processPending,
    'SELECT due',
  );
  try {
    worker.onApplicationBootstrap();
    await worker['connecting'];
    await worker['running'];
    const client = (Client as unknown as jest.Mock).mock.results[0]
      .value as MockPgClient;
    expect(client.query).toHaveBeenCalledWith('LISTEN billing_test_queue');
    expect(processPending).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(processPending).toHaveBeenCalledTimes(1);
    query.mockResolvedValueOnce([{ delay_ms: 5_000 }]);
    client.emit('notification', { channel: 'billing_test_queue' });
    await worker['running'];
    expect(processPending).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(5_000);
    await worker['running'];
    expect(processPending).toHaveBeenCalledTimes(3);
    worker.recover();
    await worker['running'];
    expect(processPending).toHaveBeenCalledTimes(4);
    client.emit('error', new Error('disconnect'));
    await jest.advanceTimersByTimeAsync(1_000);
    await worker['connecting'];
    await worker['running'];
    expect(processPending).toHaveBeenCalledTimes(5);
  } finally {
    await worker.onApplicationShutdown();
    jest.useRealTimers();
  }
});
