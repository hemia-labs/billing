import { ConfigService } from '@nestjs/config';
import { PaypalClientService } from 'src/modules/paypal/paypal-client.service';
import { PaypalApiException } from 'src/modules/paypal/types';

const createResponse = (body: Record<string, unknown>, ok = true, status = 200) =>
  ({
    ok,
    status,
    text: jest.fn(async () => JSON.stringify(body)),
  }) as unknown as Response;

describe('PaypalClientService', () => {
  let fetchMock: jest.Mock;
  let service: PaypalClientService;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'paypal.baseUrl': 'https://api-m.sandbox.paypal.com',
          'paypal.clientId': 'client-id',
          'paypal.clientSecret': 'client-secret',
          'paypal.webhookId': 'webhook-id',
        };

        return values[key];
      }),
    } as unknown as ConfigService;

    service = new PaypalClientService(config);
  });

  it('uses Basic auth for OAuth and caches token', async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({ access_token: 'token-1', expires_in: 3600 }),
    );

    await expect(service.getAccessToken()).resolves.toBe('token-1');
    await expect(service.getAccessToken()).resolves.toBe('token-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    );
    expect(init.body).toBe('grant_type=client_credentials');
  });

  it('creates subscription with bearer token and extracts approval URL', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createResponse({ access_token: 'token-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        createResponse({
          id: 'I-123',
          status: 'APPROVAL_PENDING',
          links: [{ rel: 'approve', href: 'https://paypal.test/approve' }],
        }),
      );

    const result = await service.createSubscription({
      providerPlanId: 'P-123',
      customId: 'checkout_123',
      returnUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      subscriberEmail: 'user@example.com',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'I-123',
        status: 'APPROVAL_PENDING',
        approvalUrl: 'https://paypal.test/approve',
      }),
    );
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(url).toBe(
      'https://api-m.sandbox.paypal.com/v1/billing/subscriptions',
    );
    expect(headers.get('Authorization')).toBe('Bearer token-1');
    expect(JSON.parse(init.body as string)).toMatchObject({
      plan_id: 'P-123',
      custom_id: 'checkout_123',
    });
  });

  it('gets subscription by provider subscription id', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createResponse({ access_token: 'token-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        createResponse({
          id: 'I-123',
          status: 'ACTIVE',
          plan_id: 'P-123',
          billing_info: { next_billing_time: '2026-07-18T00:00:00Z' },
          subscriber: { email_address: 'user@example.com' },
        }),
      );

    const result = await service.getSubscription('I-123');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'I-123',
        status: 'ACTIVE',
        planId: 'P-123',
      }),
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api-m.sandbox.paypal.com/v1/billing/subscriptions/I-123',
    );
  });

  it('cancels subscription by provider subscription id', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createResponse({ access_token: 'token-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(createResponse({}));

    await service.cancelSubscription({
      providerSubscriptionId: 'I-123',
      reason: 'No longer needed',
    });

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(
      'https://api-m.sandbox.paypal.com/v1/billing/subscriptions/I-123/cancel',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      reason: 'No longer needed',
    });
  });

  it('verifies webhook with PayPal webhook id', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createResponse({ access_token: 'token-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        createResponse({ verification_status: 'SUCCESS' }),
      );

    const result = await service.verifyWebhook({
      transmissionId: 'transmission-id',
      transmissionTime: '2026-06-18T00:00:00Z',
      certUrl: 'https://paypal.test/cert',
      authAlgo: 'SHA256withRSA',
      transmissionSig: 'sig',
      webhookEvent: { id: 'WH-123' },
    });

    expect(result.verified).toBe(true);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      webhook_id: 'webhook-id',
      transmission_id: 'transmission-id',
      webhook_event: { id: 'WH-123' },
    });
  });

  it('throws controlled exception for PayPal API errors', async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse(
        {
          message: 'PayPal failed',
          debug_id: 'debug-123',
        },
        false,
        400,
      ),
    );

    await expect(service.getAccessToken()).rejects.toMatchObject({
      status: 400,
      endpoint: '/v1/oauth2/token',
      debugId: 'debug-123',
    } satisfies Partial<PaypalApiException>);
  });
});
