import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PaypalClientService } from '../../../../apps/api/src/modules/paypal/paypal-client.service';
import { BillingProviderRegistry } from '../../../../apps/api/src/modules/providers/billing-provider.registry';
import { PaypalBillingAdapter } from '../../../../apps/api/src/modules/providers/paypal-billing.adapter';
import { BillingProvider } from '../../../../apps/api/src/modules/billing-shared';
import type { PaypalConnectionsService } from '../../../../apps/api/src/modules/paypal-connections/paypal-connections.service';

const a = randomUUID(),
  b = randomUUID();
function fixture() {
  const connections = new Map(
    [a, b].map((id, i) => [
      id,
      {
        id,
        productId: randomUUID(),
        environment: 'sandbox' as const,
        baseUrl: 'https://api-m.sandbox.paypal.com',
        clientId: `app-${i}`,
        clientSecret: `secret-${i}`,
        webhookId: `webhook-${i}`,
        revision: '1',
      },
    ]),
  );
  const registry = {
    resolveForProduct: jest.fn((product: string) =>
      Promise.resolve(product === 'medsync' ? a : b),
    ),
    credentialsForConnection: jest.fn((id: string) => {
      const value = connections.get(id);
      return value
        ? Promise.resolve(value)
        : Promise.reject(new Error('Connection unavailable'));
    }),
    listForRecovery: () =>
      Promise.resolve(
        [...connections.values()].map(({ id, environment }) => ({
          id,
          environment,
        })),
      ),
  };
  const calls: Array<{
    url: string;
    authorization: string | null;
    body: string;
  }> = [];
  global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get('authorization');
    const body = init?.body ?? '';
    if (typeof body !== 'string')
      throw new Error('Expected a text provider request body');
    const address =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    calls.push({ url: address, authorization, body });
    if (address.endsWith('/oauth2/token')) {
      const credential = Buffer.from(
        authorization!.slice(6),
        'base64',
      ).toString();
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: `token:${credential}`,
            expires_in: 3600,
          }),
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify(
          address.includes('verify-webhook')
            ? { verification_status: 'SUCCESS' }
            : { id: 'I-SAME', status: 'ACTIVE' },
        ),
      ),
    );
  }) as typeof fetch;
  const paypal = new PaypalClientService(
    new ConfigService({
      paypal: {
        environment: 'sandbox',
        baseUrl: 'https://api-m.sandbox.paypal.com',
        clientId: 'global',
        clientSecret: 'global-secret',
        webhookId: 'global-webhook',
      },
    }),
    registry as unknown as PaypalConnectionsService,
  );
  return {
    paypal,
    registry,
    connections,
    calls,
    providers: new BillingProviderRegistry(new PaypalBillingAdapter(paypal)),
  };
}
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

it('isolates concurrent tokens and PayPal calls for two products even with the same provider resource id', async () => {
  const f = fixture();
  const ca = await f.providers.resolveConnection(
    BillingProvider.Paypal,
    'medsync',
  );
  const cb = await f.providers.resolveConnection(
    BillingProvider.Paypal,
    'other',
  );
  await Promise.all([
    f.providers.get(BillingProvider.Paypal, ca).getSubscription('I-SAME'),
    f.providers.get(BillingProvider.Paypal, cb).getSubscription('I-SAME'),
  ]);
  await f.providers.get(BillingProvider.Paypal, ca).getSubscription('I-SAME');
  expect(
    f.calls.filter((call) => call.url.endsWith('/oauth2/token')),
  ).toHaveLength(2);
  expect(
    f.calls
      .filter((call) => call.url.endsWith('/I-SAME'))
      .map((call) => call.authorization),
  ).toEqual(
    expect.arrayContaining([
      'Bearer token:app-0:secret-0',
      'Bearer token:app-1:secret-1',
    ]),
  );
  expect(f.calls.at(-1)?.authorization).toBe('Bearer token:app-0:secret-0');
});

it('keeps a pinned historical app after current selection changes and invalidates its token when credentials rotate', async () => {
  const f = fixture();
  const pinned = f.providers.get(BillingProvider.Paypal, a);
  await pinned.getSubscription('I-SAME');
  f.registry.resolveForProduct.mockResolvedValue(b);
  expect(
    await f.providers.resolveConnection(BillingProvider.Paypal, 'medsync'),
  ).toBe(b);
  await pinned.cancelSubscription({ providerSubscriptionId: 'I-SAME' });
  expect(f.calls.at(-1)?.authorization).toBe('Bearer token:app-0:secret-0');
  Object.assign(f.connections.get(a)!, {
    clientSecret: 'rotated-secret',
    revision: '2',
  });
  await pinned.getSubscription('I-SAME');
  expect(f.calls.at(-1)?.authorization).toBe(
    'Bearer token:app-0:rotated-secret',
  );
});

it('uses the exact webhook id and token for the connection being verified', async () => {
  const f = fixture();
  await f.paypal.forConnection(b).verifyWebhook({
    transmissionId: 'tx',
    transmissionTime: 'now',
    certUrl: 'https://paypal.test/cert',
    authAlgo: 'SHA256',
    transmissionSig: 'signature',
    webhookEvent: { id: 'WH-SAME' },
  });
  expect(JSON.parse(f.calls.at(-1)!.body)).toMatchObject({
    webhook_id: 'webhook-1',
  });
  expect(f.calls.at(-1)?.authorization).toBe('Bearer token:app-1:secret-1');
});

it('never falls back to global credentials for invalid, missing, or disabled configured connections', async () => {
  const f = fixture();
  expect(() => f.paypal.forConnection('invalid')).toThrow(
    'Invalid pinned provider connection',
  );
  await expect(
    f.paypal.forConnection(randomUUID()).getSubscription('I-SAME'),
  ).rejects.toThrow('Connection unavailable');
  f.registry.resolveForProduct.mockRejectedValue(new Error('disabled'));
  await expect(
    f.providers.resolveConnection(BillingProvider.Paypal, 'medsync'),
  ).rejects.toThrow('disabled');
  expect(f.calls).toEqual([]);
});

it('uses global credentials only for the explicit unpinned legacy route', async () => {
  const f = fixture();
  await f.paypal
    .forConnection(a)
    .forConnection(null)
    .getSubscription('I-LEGACY');
  expect(f.calls.at(-1)?.authorization).toBe(
    'Bearer token:global:global-secret',
  );
});

it('keeps OAuth authentication failures retryable and never forwards sensitive upstream bodies', async () => {
  const f = fixture();
  global.fetch = jest.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          message: 'sensitive provider detail',
          access_token: 'private-value',
        }),
        { status: 401 },
      ),
    ),
  ) as typeof fetch;
  await expect(
    f.paypal.forConnection(a).getSubscription('I-SAME'),
  ).rejects.toMatchObject({
    message: 'PayPal OAuth request failed',
    status: 401,
    endpoint: '/v1/oauth2/token',
    body: {},
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
