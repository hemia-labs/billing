import {
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BillingPlanCatalogResolver } from '../../../../apps/api/src/modules/catalog';
import {
  BillingPlanPriceEntity,
  BillingProvider,
  ProviderPriceStatus,
  SubscriptionStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import { BillingProviderRegistry } from '../../../../apps/api/src/modules/providers/billing-provider.registry';
import { PaypalBillingAdapter } from '../../../../apps/api/src/modules/providers/paypal-billing.adapter';

const price = (providers: BillingProvider[]) =>
  Object.assign(new BillingPlanPriceEntity(), {
    providerPrices: providers.map((provider) => ({
      provider,
      status: ProviderPriceStatus.Active,
    })),
  });
it('resolves only a uniquely configured active provider, including an unsupported provider without falling back', () => {
  const resolver = new BillingPlanCatalogResolver();
  expect(() => resolver.configuredProvider(price([]))).toThrow(
    NotFoundException,
  );
  expect(() =>
    resolver.configuredProvider(
      price([BillingProvider.Paypal, BillingProvider.Stripe]),
    ),
  ).toThrow(ConflictException);
  expect(resolver.configuredProvider(price([BillingProvider.Stripe]))).toBe(
    BillingProvider.Stripe,
  );
  const client = { createSubscription: jest.fn() };
  const registry = new BillingProviderRegistry(
    new PaypalBillingAdapter(client as never),
  );
  expect(() => registry.get(BillingProvider.Stripe)).toThrow(
    UnprocessableEntityException,
  );
  expect(client.createSubscription).not.toHaveBeenCalled();
});
it.each([
  'http://www.paypal.com/pay',
  'https://paypal.com/pay',
  'https://www.paypal.com.attacker.test/pay',
  'https://user@www.paypal.com/pay',
  'https://www.paypal.com:444/pay',
  'https://attacker.test/pay',
])('rejects untrusted approval URL on every adapter path: %s', async (url) => {
  const raw = { id: 'ORDER', links: [{ rel: 'approve', href: url }] };
  const client = {
    createSubscription: jest.fn(() =>
      Promise.resolve({ id: 'I-1', raw: {}, approvalUrl: url }),
    ),
    getSubscription: jest.fn(() =>
      Promise.resolve({ id: 'I-1', raw: {}, approvalUrl: url }),
    ),
    reviseSubscription: jest.fn(() =>
      Promise.resolve({ id: 'I-1', raw: {}, approvalUrl: url }),
    ),
    createOrder: jest.fn(() => Promise.resolve(raw)),
    getOrder: jest.fn(() => Promise.resolve(raw)),
    captureOrder: jest.fn(() => Promise.resolve(raw)),
  };
  const adapter = new PaypalBillingAdapter(client as never);
  const input = {
    providerPlanId: 'P-1',
    customId: 'checkout',
    returnUrl: 'https://consumer.test/return',
    cancelUrl: 'https://consumer.test/cancel',
  };
  const order = {
    requestId: 'request',
    checkoutId: 'checkout',
    amount: '1.00',
    currency: 'USD',
    returnUrl: input.returnUrl,
    cancelUrl: input.cancelUrl,
  };
  for (const result of [
    () => adapter.createSubscription(input),
    () => adapter.getSubscription('I-1'),
    () =>
      adapter.reviseSubscription({
        ...input,
        providerSubscriptionId: 'I-1',
        requestId: 'request',
      }),
    () => adapter.createOrder(order),
    () => adapter.getOrder('ORDER'),
    () => adapter.captureOrder('ORDER', 'request'),
  ])
    await expect(result()).rejects.toMatchObject({ status: 502 });
});
it('normalizes PayPal status and billing dates and allows its exact approval hosts', async () => {
  const adapter = new PaypalBillingAdapter({
    getSubscription: () =>
      Promise.resolve({
        id: 'I-1',
        status: 'ACTIVE',
        planId: 'P-1',
        billingInfo: {
          next_billing_time: '2030-01-01',
          last_payment: { time: '2029-12-01' },
        },
        approvalUrl: 'https://www.sandbox.paypal.com/approve',
        raw: {},
      }),
    getOrder: () =>
      Promise.resolve({
        id: 'ORDER',
        status: 'APPROVED',
        links: [
          { rel: 'payer-action', href: 'https://www.paypal.com/approve' },
        ],
        purchase_units: [],
      }),
  } as never);
  expect(await adapter.getSubscription('I-1')).toMatchObject({
    subscriptionStatus: SubscriptionStatus.Active,
    nextBillingAt: '2030-01-01',
    lastPaymentAt: '2029-12-01',
  });
  expect(await adapter.getOrder('ORDER')).toMatchObject({
    status: 'approved',
    approvalUrl: 'https://www.paypal.com/approve',
  });
});
