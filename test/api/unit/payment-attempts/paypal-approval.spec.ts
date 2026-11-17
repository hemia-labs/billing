import type { EntityManager } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BillingCheckoutSessionEntity,
  BillingCheckoutSessionStatus,
  BillingProvider,
  BillingSubscriptionEntity,
  SubscriptionStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import { BillingPaymentAttemptEntity } from '../../../../apps/api/src/modules/payment-attempts/billing-payment-attempt.entity';
import {
  preparePaypalApproval,
  projectPaypalApproval,
} from '../../../../apps/api/src/modules/payment-attempts/paypal-approval';
import { PaypalConnectionsService } from '../../../../apps/api/src/modules/paypal-connections/paypal-connections.service';
import type { PaymentAttemptResponse } from '../../../../apps/api/src/modules/payment-attempts/payment-attempt.dto';

function fixture() {
  const connectionId = '11111111-1111-4111-8111-111111111111';
  const subscription = Object.assign(new BillingSubscriptionEntity(), {
    id: '22222222-2222-4222-8222-222222222222',
    organizationId: 'org',
    productCode: 'medsync',
    provider: BillingProvider.Paypal,
    providerSubscriptionId: 'I-OWNED123',
    status: SubscriptionStatus.Pending,
    metadata: { providerConnectionId: connectionId },
  });
  const checkout = Object.assign(new BillingCheckoutSessionEntity(), {
    id: '33333333-3333-4333-8333-333333333333',
    organizationId: 'org',
    productCode: 'medsync',
    userId: 'buyer',
    provider: BillingProvider.Paypal,
    providerCheckoutUrl: 'https://www.sandbox.paypal.com/approve',
    status: BillingCheckoutSessionStatus.Created,
    metadata: {
      providerConnectionId: connectionId,
      subscriptionId: subscription.id,
      createdByIssuer: 'issuer',
      createdByClientId: 'service',
    },
  });
  const attempt = Object.assign(new BillingPaymentAttemptEntity(), {
    organizationId: 'org',
    productCode: 'medsync',
    userId: 'buyer',
    createdByIssuer: 'issuer',
    createdByClientId: 'service',
    requestPayload: {
      operation: 'checkout',
      provider: BillingProvider.Paypal,
      providerConnectionId: connectionId,
    },
  });
  const receipt: Partial<PaymentAttemptResponse> = {
    checkoutId: checkout.id,
    subscriptionId: subscription.id,
    checkoutUrl: checkout.providerCheckoutUrl,
  };
  const manager = {
    getRepository: (entity: unknown) => ({
      findOne: jest.fn(() =>
        Promise.resolve(
          entity === BillingSubscriptionEntity
            ? subscription
            : entity === BillingCheckoutSessionEntity
              ? checkout
              : null,
        ),
      ),
    }),
  } as unknown as EntityManager;
  const configuration = {
    clientId: 'PINNED-APP',
    environment: 'sandbox',
    clientSecret: 'SECRET',
    accessToken: 'TOKEN',
  };
  const connections = {
    approvalConfiguration: jest.fn(() => Promise.resolve(configuration)),
  };
  return {
    connectionId,
    subscription,
    checkout,
    attempt,
    receipt,
    manager,
    configuration,
    connections,
    prepare: () =>
      preparePaypalApproval(
        manager,
        attempt,
        receipt,
        connections as unknown as PaypalConnectionsService,
      ),
  };
}
type Fixture = ReturnType<typeof fixture>;

describe('safe PayPal subscription popup configuration', () => {
  it('uses only the owned existing subscription and its pinned connection, stripping credential fields', async () => {
    const f = fixture();
    expect(await f.prepare()).toEqual({
      kind: 'subscription',
      subscriptionId: 'I-OWNED123',
      clientId: 'PINNED-APP',
      environment: 'sandbox',
    });
    expect(f.connections.approvalConfiguration).toHaveBeenCalledWith(
      f.connectionId,
    );
    expect(JSON.stringify(await f.prepare())).not.toMatch(/SECRET|TOKEN/);
  });
  it('supports explicitly pinned global configuration without guessing a connection for legacy records', async () => {
    const f = fixture();
    f.attempt.requestPayload.providerConnectionId = null;
    delete f.subscription.metadata.providerConnectionId;
    delete f.checkout.metadata.providerConnectionId;
    expect(await f.prepare()).toBeDefined();
    expect(f.connections.approvalConfiguration).toHaveBeenCalledWith(null);
    delete f.attempt.requestPayload.providerConnectionId;
    expect(await f.prepare()).toBeUndefined();
  });
  it('supports a live connection only with its live approval URL', async () => {
    const f = fixture();
    f.configuration.environment = 'live';
    expect(await f.prepare()).toBeUndefined();
    f.checkout.providerCheckoutUrl = f.receipt.checkoutUrl =
      'https://www.paypal.com/approve';
    expect(await f.prepare()).toMatchObject({ environment: 'live' });
  });
  it.each([
    [
      'plan change',
      (f: Fixture) => {
        f.attempt.requestPayload.operation = 'change_plan';
      },
    ],
    [
      'renewal',
      (f: Fixture) => {
        f.attempt.requestPayload.operation = 'resume_renewal';
      },
    ],
    [
      'other organization',
      (f: Fixture) => {
        f.subscription.organizationId = 'other';
      },
    ],
    [
      'other product',
      (f: Fixture) => {
        f.subscription.productCode = 'other';
      },
    ],
    [
      'other subscription',
      (f: Fixture) => {
        f.subscription.id = 'other';
      },
    ],
    [
      'active subscription',
      (f: Fixture) => {
        f.subscription.status = SubscriptionStatus.Active;
      },
    ],
    [
      'abandoned subscription',
      (f: Fixture) => {
        f.subscription.metadata.checkoutAbandonment = {};
      },
    ],
    [
      'revision subscription',
      (f: Fixture) => {
        f.subscription.metadata.operation = 'plan_change';
      },
    ],
    [
      'subscription connection mismatch',
      (f: Fixture) => {
        f.subscription.metadata.providerConnectionId =
          '44444444-4444-4444-8444-444444444444';
      },
    ],
    [
      'other buyer',
      (f: Fixture) => {
        f.checkout.userId = 'other';
      },
    ],
    [
      'other checkout organization',
      (f: Fixture) => {
        f.checkout.organizationId = 'other';
      },
    ],
    [
      'other checkout issuer',
      (f: Fixture) => {
        f.checkout.metadata.createdByIssuer = 'other';
      },
    ],
    [
      'other checkout service',
      (f: Fixture) => {
        f.checkout.metadata.createdByClientId = 'other';
      },
    ],
    [
      'unbound checkout',
      (f: Fixture) => {
        f.checkout.metadata.subscriptionId = 'other';
      },
    ],
    [
      'checkout connection mismatch',
      (f: Fixture) => {
        f.checkout.metadata.providerConnectionId =
          '44444444-4444-4444-8444-444444444444';
      },
    ],
    [
      'approved checkout',
      (f: Fixture) => {
        f.checkout.status = BillingCheckoutSessionStatus.Approved;
      },
    ],
    [
      'proration checkout',
      (f: Fixture) => {
        f.checkout.metadata.operation = 'plan_change_proration';
      },
    ],
    [
      'internal UUID as provider ID',
      (f: Fixture) => {
        f.subscription.providerSubscriptionId = f.subscription.id;
      },
    ],
    [
      'injected client ID URL',
      (f: Fixture) => {
        f.configuration.clientId = 'https://other.test';
      },
    ],
    [
      'unknown environment',
      (f: Fixture) => {
        f.configuration.environment = 'test';
      },
    ],
  ] as const)('omits popup configuration for %s', async (_name, mutate) => {
    const f = fixture();
    mutate(f);
    expect(await f.prepare()).toBeUndefined();
  });
  it.each([
    'http://www.sandbox.paypal.com/approve',
    'https://www.sandbox.paypal.com:444/approve',
    'https://buyer:password@www.sandbox.paypal.com/approve',
    'https://evil.test/approve',
  ])('rejects an unsafe provider URL %s', (url) => {
    expect(
      projectPaypalApproval(
        {
          kind: 'subscription',
          subscriptionId: 'I-123',
          clientId: 'APP',
          environment: 'sandbox',
        },
        url,
      ),
    ).toBeUndefined();
  });
});

describe('public approval configuration projection', () => {
  it('selects only public fields for the pinned historical connection without decrypting anything', async () => {
    const findOne = jest.fn(() =>
      Promise.resolve({
        clientId: 'PINNED-APP',
        environment: 'live',
        clientSecretEncrypted: 'SECRET',
        webhookId: 'PRIVATE',
      }),
    );
    const decrypt = jest.fn();
    const service = new PaypalConnectionsService(
      { findOne } as never,
      {} as never,
      { decrypt } as never,
      {} as ConfigService,
    );
    expect(await service.approvalConfiguration('historical-id')).toEqual({
      clientId: 'PINNED-APP',
      environment: 'live',
    });
    expect(findOne).toHaveBeenCalledWith({
      where: { id: 'historical-id', isDraft: false },
      select: { clientId: true, environment: true },
    });
    expect(decrypt).not.toHaveBeenCalled();
  });
  it('exposes only the namespaced global public configuration', async () => {
    const get = jest.fn(
      (key: string) =>
        ({ 'paypal.clientId': 'GLOBAL-APP', 'paypal.environment': 'sandbox' })[
          key
        ],
    );
    const service = new PaypalConnectionsService(
      {} as never,
      {} as never,
      {} as never,
      { get } as never,
    );
    expect(await service.approvalConfiguration(null)).toEqual({
      clientId: 'GLOBAL-APP',
      environment: 'sandbox',
    });
    expect(get.mock.calls.map(([key]) => key)).toEqual([
      'paypal.clientId',
      'paypal.environment',
    ]);
  });
});
