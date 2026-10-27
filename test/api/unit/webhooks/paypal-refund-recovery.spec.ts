import { Logger } from '@nestjs/common';
import { PaypalRefundRecoveryService } from '../../../../apps/api/src/modules/webhooks/paypal/paypal-refund-recovery.service';

const SALE = 'PAYMENT.SALE.REFUNDED';
const CAPTURE = 'PAYMENT.CAPTURE.REFUNDED';
const now = Date.parse('2026-10-27T20:00:00.789Z');
const sale = (id = 'WH-REFUND', saleId = 'SALE1') => ({
  id,
  event_type: SALE,
  resource: { sale_id: saleId, id: 'REFUND1' },
});
const capture = (href: string) => ({
  id: 'WH-CAPTURE',
  event_type: CAPTURE,
  resource: { id: 'REFUND2', links: [{ rel: 'up', href }] },
});

function fixture() {
  const known = new Set<string>();
  const owned = new Set(['SALE1', 'CAPTURE1']);
  const query = jest.fn((_sql: string, params: string[]) =>
    Promise.resolve(
      owned.has(params[0]) && !known.has(params[1])
        ? [{ id: 'payment-id' }]
        : [],
    ),
  );
  const settings: Record<string, string> = {
    'paypal.baseUrl': 'https://api-m.sandbox.paypal.com',
    'paypal.environment': 'sandbox',
    'paypal.webhookId': 'PROD-WEBHOOK',
    'paypal.clientId': 'client',
    'paypal.clientSecret': 'secret',
  };
  const config = {
    get: (key: string) => settings[key],
    getOrThrow: (key: string) => settings[key],
  };
  let page: (type: string, url: URL) => Record<string, unknown> = () => ({
    events: [],
  });
  const resend = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
  const fetchMock = jest.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (init?.method === 'POST') {
      await resend(url.pathname.split('/').at(-2)!);
      return new Response('{}', { status: 202 });
    }
    return new Response(
      JSON.stringify(page(url.searchParams.get('event_type')!, url)),
      { status: 200 },
    );
  });
  global.fetch = fetchMock as typeof fetch;
  const paypal = { getAccessToken: jest.fn(() => Promise.resolve('token')) };
  const service = new PaypalRefundRecoveryService(
    { query } as never,
    paypal as never,
    config as never,
  );
  return {
    service,
    query,
    known,
    owned,
    settings,
    resend,
    fetchMock,
    paypal,
    pages: (value: typeof page) => {
      page = value;
    },
  };
}

const originalFetch = global.fetch;
let logError: jest.SpyInstance;
let logCompleted: jest.SpyInstance;
beforeEach(() => {
  logCompleted = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation(() => undefined);
  jest.spyOn(Date, 'now').mockReturnValue(now);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  logError = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

it('requests signed redelivery only to the configured webhook for a missing refund of an owned payment', async () => {
  const f = fixture();
  f.pages((type) => ({ events: type === SALE ? [sale()] : [] }));
  await f.service.recover();
  expect(f.resend).toHaveBeenCalledWith('WH-REFUND');
  expect(logCompleted).toHaveBeenCalledWith({
    event: 'billing_paypal_refund_recovery_completed',
    examined: 1,
    redeliveries: 1,
  });
  const call = f.fetchMock.mock.calls.find(
    ([, init]) => init?.method === 'POST',
  )!;
  expect(call[1]?.body).toBe(JSON.stringify({ webhook_ids: ['PROD-WEBHOOK'] }));
  expect(call[1]?.headers).toEqual({
    Authorization: 'Bearer token',
    'Content-Type': 'application/json',
  });
  expect(f.query.mock.calls[0][0]).toContain('NOT EXISTS');
  expect(f.query.mock.calls[0][0]).not.toContain('processing_status');
  const first = new URL(f.fetchMock.mock.calls[0][0]);
  expect(first.searchParams.get('start_time')).toBe('2026-09-27T20:00:00Z');
  expect(first.searchParams.get('end_time')).toBe('2026-10-27T20:00:00Z');
});

it('does not replay already received events (including ignored) or payments from another environment', async () => {
  const f = fixture();
  f.known.add('WH-IGNORED');
  f.pages((type) => ({
    events:
      type === SALE ? [sale('WH-IGNORED'), sale('WH-FOREIGN', 'OTHER')] : [],
  }));
  await f.service.recover();
  expect(f.resend).not.toHaveBeenCalled();
});

it('follows PayPal next-page links and preserves the bounded type and time filters', async () => {
  const f = fixture();
  f.pages((type, url) =>
    type !== SALE
      ? { events: [] }
      : url.searchParams.has('page')
        ? { events: [sale()] }
        : {
            events: [],
            links: [
              {
                rel: 'next',
                href: 'https://api.sandbox.paypal.com/v1/notifications/webhooks-events?page=2',
              },
            ],
          },
  );
  await f.service.recover();
  expect(f.resend).toHaveBeenCalledTimes(1);
  const second = new URL(f.fetchMock.mock.calls[1][0]);
  expect(second.origin).toBe('https://api-m.sandbox.paypal.com');
  expect(second.searchParams.get('page')).toBe('2');
  expect(second.searchParams.get('event_type')).toBe(SALE);
  expect(second.searchParams.get('start_time')).toBe('2026-09-27T20:00:00Z');
});

it('does not follow pagination outside the PayPal event-list endpoint', async () => {
  const f = fixture();
  f.pages(() => ({
    events: [],
    links: [
      {
        rel: 'next',
        href: 'https://attacker.example/v1/notifications/webhooks-events',
      },
    ],
  }));
  await f.service.recover();
  expect(f.fetchMock).toHaveBeenCalledTimes(1);
  expect(logError).toHaveBeenCalledWith({
    event: 'billing_paypal_refund_recovery_failed',
    reason: 'Invalid PayPal pagination URL',
  });
});

it('matches capture refunds by their PayPal up link, never by the refund id', async () => {
  const f = fixture();
  f.pages((type) => ({
    events:
      type === CAPTURE
        ? [
            capture(
              'https://api.sandbox.paypal.com/v2/payments/captures/CAPTURE1',
            ),
          ]
        : [],
  }));
  await f.service.recover();
  expect(f.query).toHaveBeenCalledWith(expect.any(String), [
    'CAPTURE1',
    'WH-CAPTURE',
  ]);
  expect(f.resend).toHaveBeenCalledWith('WH-CAPTURE');
});

it.each([
  'https://attacker.example/v2/payments/captures/CAPTURE1',
  'https://api.sandbox.paypal.com.attacker.example/v2/payments/captures/CAPTURE1',
  'https://api.paypal.com/v2/payments/captures/CAPTURE1',
  'http://api.sandbox.paypal.com/v2/payments/captures/CAPTURE1',
  'https://user@api.sandbox.paypal.com/v2/payments/captures/CAPTURE1',
  'https://api.sandbox.paypal.com/v2/payments/captures/CAPTURE1?x=1',
])(
  'rejects an untrusted or cross-environment capture link: %s',
  async (href) => {
    const f = fixture();
    f.pages((type) => ({ events: type === CAPTURE ? [capture(href)] : [] }));
    await f.service.recover();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.resend).not.toHaveBeenCalled();
  },
);

it('deduplicates duplicate page entries and allows another attempt only after the hourly cooldown', async () => {
  const f = fixture();
  f.pages((type) => ({ events: type === SALE ? [sale(), sale()] : [] }));
  await f.service.recover();
  await f.service.recover();
  expect(f.resend).toHaveBeenCalledTimes(1);
  jest.spyOn(Date, 'now').mockReturnValue(now + 60 * 60 * 1000);
  await f.service.recover();
  expect(f.resend).toHaveBeenCalledTimes(2);
});

it('retries a failed redelivery after the cooldown and does not modify financial state', async () => {
  const f = fixture();
  f.pages((type) => ({ events: type === SALE ? [sale()] : [] }));
  f.resend.mockRejectedValueOnce(new Error('temporary failure'));
  await f.service.recover();
  await f.service.recover();
  expect(f.resend).toHaveBeenCalledTimes(1);
  expect(logError).toHaveBeenCalledWith({
    event: 'billing_paypal_refund_redelivery_failed',
    providerEventId: 'WH-REFUND',
  });
  jest.spyOn(Date, 'now').mockReturnValue(now + 60 * 60 * 1000);
  await f.service.recover();
  expect(f.resend).toHaveBeenCalledTimes(2);
  expect(f.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(
    true,
  );
});

it('does not silently truncate a scan at the page limit', async () => {
  const f = fixture();
  f.pages((type) => ({
    events: [],
    ...(type === SALE
      ? {
          links: [
            {
              rel: 'next',
              href: 'https://api.sandbox.paypal.com/v1/notifications/webhooks-events?page=2',
            },
          ],
        }
      : {}),
  }));
  await f.service.recover();
  expect(logError).toHaveBeenCalledWith({
    event: 'billing_paypal_refund_recovery_page_limit',
    eventType: SALE,
    maxPages: 20,
  });
  expect(f.fetchMock).toHaveBeenCalledTimes(21);
  expect(logCompleted).not.toHaveBeenCalled();
});

it('recovers on startup, coalesces concurrent cycles, and stops at shutdown', async () => {
  const f = fixture();
  f.service.onApplicationBootstrap();
  await f.service.recover();
  expect(f.fetchMock).toHaveBeenCalledTimes(2);
  await f.service.onApplicationShutdown();
  await f.service.recover();
  expect(f.fetchMock).toHaveBeenCalledTimes(2);
});

it('can retry a failed listing on the next cycle', async () => {
  const f = fixture();
  f.fetchMock.mockRejectedValueOnce(new Error('network failure'));
  await f.service.recover();
  await f.service.recover();
  expect(f.fetchMock).toHaveBeenCalledTimes(3);
});

it('uses whole-second ISO8601 filters accepted by PayPal history even when the clock has milliseconds', async () => {
  const f = fixture();
  await f.service.recover();
  for (const [input] of f.fetchMock.mock.calls) {
    const url = new URL(input);
    for (const key of ['start_time', 'end_time']) {
      const value = url.searchParams.get(key)!;
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(Number.isFinite(Date.parse(value))).toBe(true);
    }
    expect(
      Date.parse(url.searchParams.get('end_time')!) -
        Date.parse(url.searchParams.get('start_time')!),
    ).toBe(30 * 24 * 60 * 60 * 1000);
  }
});

it('logs a safe HTTP failure reason without the provider response body', async () => {
  const f = fixture();
  f.fetchMock.mockResolvedValueOnce(
    new Response('sensitive-provider-response', { status: 400 }),
  );
  await f.service.recover();
  expect(logError).toHaveBeenCalledWith({
    event: 'billing_paypal_refund_recovery_failed',
    reason: 'PayPal recovery HTTP 400',
  });
});

it('does not log arbitrary upstream token or transport error messages', async () => {
  const f = fixture();
  f.paypal.getAccessToken.mockRejectedValueOnce(
    new Error('sensitive-token-secret'),
  );
  await f.service.recover();
  expect(logError).toHaveBeenCalledWith({
    event: 'billing_paypal_refund_recovery_failed',
    reason: 'PayPal recovery request failed',
  });
});
