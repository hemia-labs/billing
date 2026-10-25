import { ConfigService } from '@nestjs/config';
import { PaypalClientService } from '../../../../apps/api/src/modules/paypal/paypal-client.service';
describe('PayPal proration Orders HTTP requests', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });
  it('requests full representations and separates create/capture idempotency keys', async () => {
    const client = new PaypalClientService(
      new ConfigService({ paypal: { environment: 'sandbox' } }),
    );
    jest.spyOn(client, 'getAccessToken').mockResolvedValue('test-token');
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'ORDER-1',
              status: 'CREATED',
              purchase_units: [],
            }),
            { status: 200 },
          ),
        ),
      );
    global.fetch = fetcher;
    await client.createOrder({
      requestId: 'create-key',
      checkoutId: 'checkout-1',
      amount: '150.00',
      currency: 'MXN',
      returnUrl: 'https://balanz.test/success',
      cancelUrl: 'https://balanz.test/cancel',
    });
    const createHeaders = fetcher.mock.calls[0][1]!.headers as Headers;
    expect(createHeaders.get('Prefer')).toBe('return=representation');
    expect(createHeaders.get('PayPal-Request-Id')).toBe('create-key');
    const createBody = fetcher.mock.calls[0][1]!.body;
    if (typeof createBody !== 'string')
      throw new Error('Expected a JSON request body');
    expect(JSON.parse(createBody)).toMatchObject({
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: 'checkout-1',
          amount: { currency_code: 'MXN', value: '150.00' },
        },
      ],
    });
    await client.captureOrder('ORDER-1', 'capture-key');
    const captureHeaders = fetcher.mock.calls[1][1]!.headers as Headers;
    expect(captureHeaders.get('Prefer')).toBe('return=representation');
    expect(captureHeaders.get('PayPal-Request-Id')).toBe('capture-key');
  });
});
