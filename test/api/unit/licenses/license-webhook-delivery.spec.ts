import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LicenseWebhookDeliveryService } from '../../../../apps/api/src/modules/licenses/license-webhook-delivery.service';

const oauth = {
  tokenUrl: 'https://identity.example/oauth/token',
  clientId: 'billing-legal-service',
  clientSecret: 'test-only-secret',
};
const tokenResponse = {
  access_token: 'header.payload.signature',
  token_type: 'Bearer',
  expires_in: 120,
  scope: 'billing.webhooks.deliver',
};
const item = {
  organization_id: 'organization',
  product_code: 'balanz_cfdi',
  url: 'https://balanz.example/webhook',
  resource: 'https://balanz.example',
  audience: 'balanz-api',
  revision: '12',
  attempts: 2,
};
const license = { active: true, validUntil: null };
function fixture(count = 1, config: Record<string, unknown> = {}) {
  const queue = Array.from({ length: count }, () => ({
    ...item,
    ...(typeof config.receiver === 'object' ? config.receiver : {}),
  }));
  const updates: unknown[][] = [];
  const db = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      if (sql.includes('WITH candidate')) {
        const row = queue.shift();
        return Promise.resolve([row ? [row] : [], row ? 1 : 0]);
      }
      if (sql.startsWith('UPDATE billing_license_deliveries')) {
        updates.push(params);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }),
  };
  const service = new LicenseWebhookDeliveryService(
    db as never,
    new ConfigService({
      app: { nodeEnv: 'test' },
      hemiaLegal: oauth,
      ...config,
    }),
    { resolveLicense: jest.fn().mockResolvedValue(license) } as never,
  );
  return {
    service,
    queue,
    updates,
    db,
    deliver: () =>
      (service as unknown as { deliver(): Promise<void> }).deliver(),
  };
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('Billing OAuth delivery to Balanz', () => {
  const originalFetch = global.fetch;
  let fetcher: jest.Mock;
  beforeEach(() => {
    fetcher = jest.fn((url: URL) =>
      Promise.resolve(
        response(
          url.href === oauth.tokenUrl ? tokenResponse : { received: true },
        ),
      ),
    );
    global.fetch = fetcher;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reuses Billing credentials with an exact destination and preserves delivery data', async () => {
    const f = fixture();
    await f.deliver();
    const calls = fetcher.mock.calls as [URL, RequestInit][];
    expect(calls).toHaveLength(2);
    expect(Object.fromEntries(calls[0][1].body as URLSearchParams)).toEqual({
      grant_type: 'client_credentials',
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      audience: 'balanz-api',
      resource: 'https://balanz.example',
      scope: 'billing.webhooks.deliver',
    });
    expect(calls[1][1].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenResponse.access_token}`,
      'x-billing-timestamp': expect.any(String) as unknown,
    });
    const headers = calls[1][1].headers as Record<string, string>;
    expect(
      Math.abs(Date.now() / 1000 - Number(headers['x-billing-timestamp'])),
    ).toBeLessThan(2);
    expect(JSON.parse(calls[1][1].body as string)).toEqual({
      type: 'billing.license.updated',
      organizationId: item.organization_id,
      productCode: 'balanz_cfdi',
      revision: item.revision,
      license,
      checkouts: [],
    });
    expect(
      calls.every(([, init]) => init.redirect === 'error' && init.signal),
    ).toBe(true);
    expect(f.updates[0]).toEqual([
      item.organization_id,
      expect.any(String),
      item.revision,
      true,
      20,
      item.product_code,
    ]);
  });

  it('isolates two products of the same organization and requests each receiver destination', async () => {
    const f = fixture(2);
    f.queue[1] = {
      ...item,
      product_code: 'another-product',
      url: 'https://another.example/license',
      resource: 'https://another.example',
      audience: 'another-api',
    };
    await f.deliver();
    const calls = fetcher.mock.calls as [URL, RequestInit][];
    const tokens = calls
      .filter(([url]) => String(url) === oauth.tokenUrl)
      .map(([, init]) => Object.fromEntries(init.body as URLSearchParams));
    expect(tokens.map((t) => t.audience)).toEqual([
      'balanz-api',
      'another-api',
    ]);
    expect(tokens.map((t) => t.resource)).toEqual([
      'https://balanz.example',
      'https://another.example',
    ]);
    expect(f.updates.map((u) => u[5])).toEqual([
      'balanz_cfdi',
      'another-product',
    ]);
    expect(
      calls
        .filter(([url]) => String(url) !== oauth.tokenUrl)
        .map(
          ([, init]) =>
            (JSON.parse(init.body as string) as { productCode: string })
              .productCode,
        ),
    ).toEqual(['balanz_cfdi', 'another-product']);
  });
  it('checks the configured receiver without posting license changes', async () => {
    const f = fixture();
    f.db.query.mockResolvedValueOnce([
      { url: item.url, resource: item.resource, audience: item.audience },
    ] as never);
    fetcher
      .mockResolvedValueOnce(response(tokenResponse))
      .mockResolvedValueOnce(
        response({
          ready: true,
          contract: 'billing.license.receiver',
          productCode: item.product_code,
        }),
      );
    await expect(
      f.service.checkReceiver(item.product_code),
    ).resolves.toMatchObject({ ready: true });
    const calls = fetcher.mock.calls as [URL, RequestInit][];
    expect(calls[1][1].method).toBe('GET');
    expect(calls[1][0].searchParams.get('productCode')).toBe(item.product_code);
    expect(calls[1][1].headers).toHaveProperty('x-billing-timestamp');
    expect(f.updates).toEqual([]);
  });

  it('shares one token issuance across concurrent deliveries and renews 30 seconds early', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const f = fixture(2);
    await Promise.all([f.deliver(), f.deliver()]);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url) === oauth.tokenUrl),
    ).toHaveLength(1);
    now += 89_000;
    f.queue.push({ ...item });
    await f.deliver();
    expect(
      fetcher.mock.calls.filter(([url]) => String(url) === oauth.tokenUrl),
    ).toHaveLength(1);
    now += 1_000;
    f.queue.push({ ...item });
    await f.deliver();
    expect(
      fetcher.mock.calls.filter(([url]) => String(url) === oauth.tokenUrl),
    ).toHaveLength(2);
    expect(f.updates.every((update) => update[3] === true)).toBe(true);
  });

  it.each([
    ['OAuth rejection', () => response({}, 401)],
    [
      'OAuth unavailable',
      () => Promise.reject(new Error('network unavailable')),
    ],
    ['invalid lifetime', () => response({ ...tokenResponse, expires_in: 601 })],
    ['zero lifetime', () => response({ ...tokenResponse, expires_in: 0 })],
    [
      'wrong scope',
      () => response({ ...tokenResponse, scope: 'legal.acceptances.validate' }),
    ],
    [
      'broad scope',
      () =>
        response({
          ...tokenResponse,
          scope: 'billing.webhooks.deliver other.scope',
        }),
    ],
    ['missing scope', () => response({ ...tokenResponse, scope: undefined })],
    [
      'wrong token type',
      () => response({ ...tokenResponse, token_type: 'Basic' }),
    ],
    [
      'invalid token',
      () => response({ ...tokenResponse, access_token: 'invalid\r\nheader' }),
    ],
  ])(
    'leaves delivery pending on %s and retries OAuth next time',
    async (_name, reply) => {
      fetcher.mockImplementationOnce(reply);
      const f = fixture();
      await f.deliver();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(f.updates[0][3]).toBe(false);
      f.queue.push({ ...item, attempts: 3 });
      await f.deliver();
      expect(f.updates[1][3]).toBe(true);
      expect(f.updates[1][4]).toBe(40);
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it.each([401, 403, 500])(
    'leaves rejected HTTP %s delivery pending without HMAC fallback',
    async (status) => {
      fetcher
        .mockResolvedValueOnce(response(tokenResponse))
        .mockResolvedValueOnce(response({}, status));
      const f = fixture();
      await f.deliver();
      expect(f.updates[0][3]).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(2);
      f.queue.push({ ...item });
      await f.deliver();
      expect(f.updates[1][3]).toBe(true);
      expect(
        fetcher.mock.calls.filter(([url]) => String(url) === oauth.tokenUrl),
      ).toHaveLength(status === 401 ? 2 : 1);
      for (const [url, init] of fetcher.mock.calls as [URL, RequestInit][]) {
        if (String(url) !== oauth.tokenUrl) {
          expect(init.headers).not.toHaveProperty('x-billing-signature');
        }
      }
    },
  );

  it.each([{}, { received: false }, null])(
    'does not acknowledge an invalid receipt: %j',
    async (receipt) => {
      fetcher
        .mockResolvedValueOnce(response(tokenResponse))
        .mockResolvedValueOnce(response(receipt));
      const f = fixture();
      await f.deliver();
      expect(f.updates[0][3]).toBe(false);
    },
  );

  it.each([
    'http://public.example/webhook',
    'https://user:password@balanz.example/webhook',
    'https://balanz.example/webhook?secret=x',
    'https://balanz.example/webhook#fragment',
  ])(
    'rejects unsafe webhook URL %s before sending credentials',
    async (url) => {
      const f = fixture(1, { receiver: { url } });
      await f.deliver();
      expect(f.updates[0][3]).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    'http://identity.example/token',
    'https://user:pass@identity.example/token',
  ])('rejects unsafe token endpoint %s', async (tokenUrl) => {
    const f = fixture(1, { hemiaLegal: { ...oauth, tokenUrl } });
    await f.deliver();
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.updates[0][3]).toBe(false);
  });

  it('rejects loopback HTTP in production', async () => {
    const f = fixture(1, {
      app: { nodeEnv: 'production' },
      receiver: { url: 'http://127.0.0.1/webhook' },
    });
    await f.deliver();
    expect(f.updates[0][3]).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('delivers through real loopback HTTP with OAuth and a confirmed receipt', async () => {
    global.fetch = originalFetch;
    const received: {
      url?: string;
      authorization?: string;
      signature?: string;
      body: string;
    }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += String(chunk);
      });
      req.on('error', () => res.destroy());
      req.on('end', () => {
        received.push({
          url: req.url,
          authorization: req.headers.authorization,
          signature: req.headers['x-billing-signature'] as string | undefined,
          body,
        });
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify(
            req.url === '/token' ? tokenResponse : { received: true },
          ),
        );
      });
    });
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const f = fixture(1, {
        receiver: { url: `${base}/webhook`, resource: base },
        hemiaLegal: { ...oauth, tokenUrl: `${base}/token` },
      });
      await f.deliver();
      expect(received.map((r) => r.url)).toEqual(['/token', '/webhook']);
      expect(new URLSearchParams(received[0].body).get('audience')).toBe(
        'balanz-api',
      );
      expect(received[1].authorization).toBe(
        `Bearer ${tokenResponse.access_token}`,
      );
      expect(received[1].signature).toBeUndefined();
      expect(f.updates[0][3]).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
