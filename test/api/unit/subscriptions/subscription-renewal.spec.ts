import {
  BillingFeatureDefinitionEntity,
  BillingLicenseEntity,
  BillingPaymentEntity,
  BillingPlanEntitlementEntity,
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProductEntity,
  BillingProvider,
  BillingSubscriptionEntity,
  LicenseStatus,
  PaymentStatus,
  PlanVersionStatus,
  SubscriptionStatus,
  WebhookProcessingStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import type { BillingAuditRecordInput } from '../../../../apps/api/src/modules/audit/types';
import { BillingPlanCatalogResolver } from '../../../../apps/api/src/modules/catalog';
import { BillingLicenseCalculatorService } from '../../../../apps/api/src/modules/licenses';
import { BillingLicenseMapper } from '../../../../apps/api/src/modules/licenses/mappers';
import type { PaypalSubscriptionDetails } from '../../../../apps/api/src/modules/paypal/types';
import { BillingSubscriptionPaymentsProcessorService } from '../../../../apps/api/src/modules/webhooks/paypal/billing-subscription-payments-processor.service';

function fixture(status = SubscriptionStatus.Active) {
  const now = new Date();
  const expired = new Date(now.getTime() - 86400000);
  const nextBilling = new Date(now.getTime() + 30 * 86400000);
  const feature = Object.assign(new BillingFeatureDefinitionEntity(), {
    code: 'users.included',
  });
  const entitlement = Object.assign(new BillingPlanEntitlementEntity(), {
    feature,
    valueJson: 2,
  });
  const price = Object.assign(new BillingPlanPriceEntity(), { id: 'price-v1' });
  const version = Object.assign(new BillingPlanVersionEntity(), {
    id: 'v1',
    version: 1,
    status: PlanVersionStatus.Archived,
    prices: [price],
    entitlements: [entitlement],
  });
  const plan = Object.assign(new BillingPlanEntity(), {
    id: 'plan',
    versions: [version],
  });
  const product = Object.assign(new BillingProductEntity(), {
    id: 'product',
    code: 'medsync',
  });
  const subscription = Object.assign(new BillingSubscriptionEntity(), {
    id: 'subscription',
    organizationId: 'organization',
    productCode: product.code,
    planCode: 'basic',
    plan,
    planPriceId: price.id,
    provider: BillingProvider.Paypal,
    providerSubscriptionId: 'I-SUBSCRIPTION',
    status,
    nextBillingTime: expired,
    currentPeriodStart: new Date(expired.getTime() - 30 * 86400000),
    currentPeriodEnd: expired,
    graceUntil: status === SubscriptionStatus.PastDue ? expired : null,
    metadata: {},
  });
  const license = Object.assign(new BillingLicenseEntity(), {
    id: 'license',
    subscriptionId: subscription.id,
    productCode: product.code,
    status:
      status === SubscriptionStatus.PastDue
        ? LicenseStatus.Grace
        : LicenseStatus.Active,
    validUntil: expired,
    featuresJson: {},
    seatsLimit: 2,
  });
  const billingInfo: Record<string, unknown> = {
    next_billing_time: nextBilling.toISOString(),
    failed_payments_count: 0,
    last_payment: {
      time: now.toISOString(),
      amount: { value: '499.00', currency_code: 'MXN' },
    },
    cycle_executions: [
      { tenure_type: 'REGULAR', sequence: 1, cycles_completed: 2 },
    ],
  };
  const snapshot: PaypalSubscriptionDetails = {
    id: subscription.providerSubscriptionId,
    status: 'ACTIVE',
    billingInfo,
    raw: { status: 'ACTIVE', billing_info: billingInfo },
  };
  const paypal = {
    getSubscription: jest.fn((id: string) => {
      if (id !== subscription.providerSubscriptionId) {
        throw new Error('Unknown provider subscription');
      }
      return Promise.resolve(snapshot);
    }),
  };
  const subscriptions = {
    findOne: jest.fn(
      ({ where }: { where: { providerSubscriptionId: string } }) =>
        Promise.resolve(
          where.providerSubscriptionId === subscription.providerSubscriptionId
            ? subscription
            : null,
        ),
    ),
    save: jest.fn((value: BillingSubscriptionEntity) => Promise.resolve(value)),
  };
  const licenses = {
    findOne: jest.fn(() => Promise.resolve(license)),
    create: jest.fn((value: Partial<BillingLicenseEntity>) =>
      Object.assign(new BillingLicenseEntity(), value),
    ),
    save: jest.fn((value: BillingLicenseEntity) => Promise.resolve(value)),
  };
  let savedPayment: BillingPaymentEntity | null = null;
  const payments = {
    findOne: jest.fn(() => Promise.resolve(savedPayment)),
    create: jest.fn((value: Partial<BillingPaymentEntity>) =>
      Object.assign(new BillingPaymentEntity(), value),
    ),
    save: jest.fn((value: BillingPaymentEntity) => {
      savedPayment = value;
      return Promise.resolve(value);
    }),
  };
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === BillingSubscriptionEntity) return subscriptions;
      if (entity === BillingLicenseEntity) return licenses;
      if (entity === BillingPaymentEntity) return payments;
      if (entity === BillingProductEntity)
        return { findOne: () => Promise.resolve(product) };
      throw new Error('Unexpected repository');
    },
  };
  const audit = {
    record: jest.fn<Promise<void>, [BillingAuditRecordInput]>(() =>
      Promise.resolve(),
    ),
  };
  const processor = new BillingSubscriptionPaymentsProcessorService(
    paypal as never,
    new BillingLicenseCalculatorService(new BillingPlanCatalogResolver()),
    audit as never,
    undefined,
    {
      process: jest.fn().mockResolvedValue({
        processingStatus: WebhookProcessingStatus.Failed,
        note: 'Payment not found',
      }),
    } as never,
  );
  const input = {
    eventId: 'event',
    providerEventId: 'WH-RENEWAL',
    eventType: 'PAYMENT.SALE.COMPLETED',
    resource: {
      id: 'SALE-PAYMENT-ID',
      billing_agreement_id: subscription.providerSubscriptionId,
      amount: { total: '499.00', currency: 'MXN' },
      create_time: now.toISOString(),
    },
  };
  return {
    product,
    processor,
    manager,
    input,
    paypal,
    snapshot,
    billingInfo,
    subscription,
    license,
    subscriptions,
    licenses,
    payments,
    audit,
    now,
    nextBilling,
  };
}

describe('paid subscription renewal', () => {
  it.each([SubscriptionStatus.Active, SubscriptionStatus.PastDue])(
    'refreshes the period and restores access for a previously %s subscription',
    async (status) => {
      const f = fixture(status);
      expect(
        BillingLicenseMapper.toResolveDto(f.license, 'medsync').active,
      ).toBe(false);
      await f.processor.process(f.manager as never, f.input);
      expect(f.paypal.getSubscription).toHaveBeenCalledWith('I-SUBSCRIPTION');
      expect(f.subscription.nextBillingTime).toEqual(f.nextBilling);
      expect(f.subscription.currentPeriodStart).toEqual(f.now);
      expect(f.subscription.currentPeriodEnd).toEqual(f.nextBilling);
      expect(f.subscription.status).toBe(SubscriptionStatus.Active);
      expect(f.subscription.graceUntil).toBeNull();
      expect(f.payments.save.mock.calls[0][0]).toMatchObject({
        status: PaymentStatus.Paid,
        amount: '499.00',
        providerCaptureId: 'SALE-PAYMENT-ID',
      });
      expect(f.license.validUntil).toEqual(f.nextBilling);
      expect(f.license.seatsLimit).toBe(2);
      expect(
        BillingLicenseMapper.toResolveDto(f.license, 'medsync').active,
      ).toBe(true);
    },
  );

  it.each([
    { subscription_id: 'I-SUBSCRIPTION' },
    {
      supplementary_data: {
        related_ids: { subscription_id: 'I-SUBSCRIPTION' },
      },
    },
  ])(
    'uses the subscription reference rather than the sale ID (%p)',
    async (reference) => {
      const f = fixture();
      const { billing_agreement_id: ignored, ...resource } = f.input.resource;
      void ignored;
      await f.processor.process(f.manager as never, {
        ...f.input,
        resource: { ...resource, ...reference },
      });
      expect(f.paypal.getSubscription).toHaveBeenCalledWith('I-SUBSCRIPTION');
      expect(f.license.validUntil).toEqual(f.nextBilling);
    },
  );

  it('propagates provider failures without mutating the expired period or granting access', async () => {
    const f = fixture();
    const previous = f.subscription.nextBillingTime;
    f.paypal.getSubscription.mockRejectedValueOnce(
      new Error('PayPal unavailable'),
    );
    await expect(
      f.processor.process(f.manager as never, f.input),
    ).rejects.toThrow('PayPal unavailable');
    expect(f.subscription.nextBillingTime).toEqual(previous);
    expect(f.subscriptions.save).not.toHaveBeenCalled();
    expect(f.payments.save).not.toHaveBeenCalled();
    expect(f.licenses.save).not.toHaveBeenCalled();
  });

  it.each([undefined, 'invalid-date'])(
    'rejects an active renewal without a valid billing date (%p)',
    async (date) => {
      const f = fixture();
      f.billingInfo.next_billing_time = date;
      await expect(
        f.processor.process(f.manager as never, f.input),
      ).rejects.toMatchObject({ status: 502 });
      expect(f.subscriptions.save).not.toHaveBeenCalled();
      expect(f.licenses.save).not.toHaveBeenCalled();
      expect(
        BillingLicenseMapper.toResolveDto(f.license, 'medsync').active,
      ).toBe(false);
    },
  );

  it.each([
    ['CANCELLED', SubscriptionStatus.Cancelled, LicenseStatus.Revoked],
    ['EXPIRED', SubscriptionStatus.Expired, LicenseStatus.Revoked],
    ['SUSPENDED', SubscriptionStatus.Suspended, LicenseStatus.Suspended],
  ])(
    'respects the current %s provider status when an old payment arrives',
    async (status, subscriptionStatus, licenseStatus) => {
      const f = fixture();
      f.snapshot.status = status;
      f.snapshot.raw.status = status;
      await f.processor.process(f.manager as never, f.input);
      expect(f.subscription.status).toBe(subscriptionStatus);
      expect(f.license.status).toBe(licenseStatus);
      expect(
        BillingLicenseMapper.toResolveDto(f.license, 'medsync').active,
      ).toBe(false);
    },
  );

  it('reuses the payment on redelivery while retaining the refreshed expiry', async () => {
    const f = fixture();
    await f.processor.process(f.manager as never, f.input);
    await f.processor.process(f.manager as never, f.input);
    expect(f.payments.create).toHaveBeenCalledTimes(1);
    expect(f.license.validUntil).toEqual(f.nextBilling);
  });
});

describe('subscription webhook resources awaiting persistence', () => {
  it.each([
    'BILLING.SUBSCRIPTION.CREATED',
    'BILLING.SUBSCRIPTION.ACTIVATED',
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
    'BILLING.SUBSCRIPTION.SUSPENDED',
    'BILLING.SUBSCRIPTION.CANCELLED',
    'BILLING.SUBSCRIPTION.EXPIRED',
    'PAYMENT.SALE.COMPLETED',
  ])(
    'keeps %s retryable until its subscription is available',
    async (eventType) => {
      const f = fixture();
      f.subscriptions.findOne.mockResolvedValueOnce(null);
      const input = {
        ...f.input,
        eventType,
        resource: eventType.startsWith('BILLING.SUBSCRIPTION.')
          ? { id: f.subscription.providerSubscriptionId }
          : f.input.resource,
      };

      const result = await f.processor.process(f.manager as never, input);
      expect(result.processingStatus).toBe(WebhookProcessingStatus.Failed);
      expect(result.note).toMatch(/subscription not found/i);
      expect(f.paypal.getSubscription).not.toHaveBeenCalled();
      expect(f.licenses.save).not.toHaveBeenCalled();
      expect(f.payments.save).not.toHaveBeenCalled();

      expect(
        await f.processor.process(f.manager as never, input),
      ).toMatchObject({
        processingStatus: WebhookProcessingStatus.Processed,
      });
    },
  );

  it.each(['PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED'])(
    'keeps %s retryable when the original payment is not available',
    async (eventType) => {
      const f = fixture();
      expect(
        await f.processor.process(f.manager as never, {
          ...f.input,
          eventType,
        }),
      ).toEqual({
        processingStatus: WebhookProcessingStatus.Failed,
        note: 'Payment not found',
      });
      expect(f.subscriptions.save).not.toHaveBeenCalled();
      expect(f.licenses.save).not.toHaveBeenCalled();
    },
  );
});

describe('subscription events confirmed by PayPal', () => {
  const subscriptionEvent = (
    f: ReturnType<typeof fixture>,
    eventType = 'BILLING.SUBSCRIPTION.ACTIVATED',
  ) => ({
    ...f.input,
    eventType,
    resource: { id: f.subscription.providerSubscriptionId, status: 'ACTIVE' },
  });

  it.each([
    [
      'CANCELLED',
      0,
      SubscriptionStatus.Cancelled,
      LicenseStatus.Revoked,
      false,
    ],
    ['EXPIRED', 0, SubscriptionStatus.Expired, LicenseStatus.Revoked, false],
    [
      'SUSPENDED',
      0,
      SubscriptionStatus.Suspended,
      LicenseStatus.Suspended,
      false,
    ],
    [
      'APPROVAL_PENDING',
      0,
      SubscriptionStatus.Pending,
      LicenseStatus.Revoked,
      false,
    ],
    ['APPROVED', 0, SubscriptionStatus.Pending, LicenseStatus.Revoked, false],
    ['ACTIVE', 0, SubscriptionStatus.Active, LicenseStatus.Active, true],
    ['ACTIVE', 1, SubscriptionStatus.PastDue, LicenseStatus.Grace, true],
    ['ACTIVE', 3, SubscriptionStatus.Suspended, LicenseStatus.Suspended, false],
  ] as const)(
    'derives activation access from current %s status and %i failed payments',
    async (status, failures, subscriptionStatus, licenseStatus, active) => {
      const f = fixture();
      f.snapshot.status = status;
      f.snapshot.raw.status = status;
      f.billingInfo.failed_payments_count = failures;

      await f.processor.process(f.manager as never, subscriptionEvent(f));

      expect(f.paypal.getSubscription).toHaveBeenCalledWith('I-SUBSCRIPTION');
      expect(f.subscription.status).toBe(subscriptionStatus);
      expect(f.license.status).toBe(licenseStatus);
      expect(
        BillingLicenseMapper.toResolveDto(f.license, 'medsync').active,
      ).toBe(active);
      if (licenseStatus !== LicenseStatus.Active) {
        const licenseAudit = f.audit.record.mock.calls
          .map(([entry]) => entry)
          .find((entry) => entry.action === 'billing.license.status_changed');
        expect(licenseAudit?.metadata).toMatchObject({
          newStatus: licenseStatus,
        });
      }
    },
  );

  it('does not restore a subscription or license after a refund revocation marker', async () => {
    const f = fixture(SubscriptionStatus.Cancelled);
    f.subscription.metadata = {
      refundRevocation: { refundId: 'REFUND-CURRENT-PERIOD' },
    };
    f.license.status = LicenseStatus.Revoked;
    f.snapshot.status = 'ACTIVE';
    f.snapshot.raw.status = 'ACTIVE';

    await f.processor.process(
      f.manager as never,
      subscriptionEvent(f, 'BILLING.SUBSCRIPTION.ACTIVATED'),
    );

    expect(f.subscription.status).toBe(SubscriptionStatus.Cancelled);
    expect(f.subscription.metadata).toHaveProperty('refundRevocation');
    expect(f.license.status).toBe(LicenseStatus.Revoked);
  });

  it.each([
    'BILLING.SUBSCRIPTION.SUSPENDED',
    'BILLING.SUBSCRIPTION.CANCELLED',
    'BILLING.SUBSCRIPTION.EXPIRED',
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  ])(
    'retains access when a late %s arrives after recovery',
    async (eventType) => {
      const f = fixture(SubscriptionStatus.Suspended);
      f.license.status = LicenseStatus.Suspended;

      await f.processor.process(
        f.manager as never,
        subscriptionEvent(f, eventType),
      );

      expect(f.subscription.status).toBe(SubscriptionStatus.Active);
      expect(f.license.status).toBe(LicenseStatus.Active);
      expect(f.license.validUntil).toEqual(f.nextBilling);
      expect(f.subscription.graceUntil).toBeNull();
      expect(
        BillingLicenseMapper.toResolveDto(f.license, 'medsync').active,
      ).toBe(true);
      expect(f.subscriptions.save).toHaveBeenCalledTimes(1);
    },
  );

  it('does not grant grace access for a failed payment after cancellation', async () => {
    const f = fixture(SubscriptionStatus.Cancelled);
    f.snapshot.status = 'CANCELLED';
    f.snapshot.raw.status = 'CANCELLED';

    await f.processor.process(
      f.manager as never,
      subscriptionEvent(f, 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'),
    );

    expect(f.subscription.status).toBe(SubscriptionStatus.Cancelled);
    expect(f.license.status).toBe(LicenseStatus.Revoked);
    expect(BillingLicenseMapper.toResolveDto(f.license, 'medsync').active).toBe(
      false,
    );
    expect(f.subscriptions.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['CANCELLED', SubscriptionStatus.Cancelled, LicenseStatus.Revoked],
    ['EXPIRED', SubscriptionStatus.Expired, LicenseStatus.Revoked],
    ['SUSPENDED', SubscriptionStatus.Suspended, LicenseStatus.Suspended],
  ])(
    'preserves current %s status despite old failed payments',
    async (status, subscriptionStatus, licenseStatus) => {
      const f = fixture();
      f.snapshot.status = status;
      f.snapshot.raw.status = status;
      f.billingInfo.failed_payments_count = 3;

      await f.processor.process(f.manager as never, subscriptionEvent(f));

      expect(f.subscription.status).toBe(subscriptionStatus);
      expect(f.license.status).toBe(licenseStatus);
      expect(
        BillingLicenseMapper.toResolveDto(f.license, 'medsync').active,
      ).toBe(false);
    },
  );

  it.each([undefined, 'UNKNOWN'])(
    'rejects activation without a confirmed status (%p)',
    async (status) => {
      const f = fixture(SubscriptionStatus.Cancelled);
      f.license.status = LicenseStatus.Revoked;
      f.snapshot.status = status;
      f.snapshot.raw.status = status;

      await expect(
        f.processor.process(f.manager as never, subscriptionEvent(f)),
      ).rejects.toMatchObject({ status: 502 });

      expect(f.subscription.status).toBe(SubscriptionStatus.Cancelled);
      expect(f.license.status).toBe(LicenseStatus.Revoked);
      expect(f.subscriptions.save).not.toHaveBeenCalled();
      expect(f.licenses.save).not.toHaveBeenCalled();
      expect(f.audit.record).not.toHaveBeenCalled();
    },
  );

  it('keeps revoked access when PayPal cannot confirm activation', async () => {
    const f = fixture(SubscriptionStatus.Cancelled);
    f.license.status = LicenseStatus.Revoked;
    f.paypal.getSubscription.mockRejectedValueOnce(
      new Error('PayPal unavailable'),
    );

    await expect(
      f.processor.process(f.manager as never, subscriptionEvent(f)),
    ).rejects.toThrow('PayPal unavailable');

    expect(f.subscription.status).toBe(SubscriptionStatus.Cancelled);
    expect(f.license.status).toBe(LicenseStatus.Revoked);
    expect(f.subscriptions.save).not.toHaveBeenCalled();
    expect(f.licenses.save).not.toHaveBeenCalled();
  });
});

// Cancellation preserves paid rights without extending the provider-confirmed period.
describe('scheduled cancellation rights', () => {
  it('keeps a scheduled cancelled license active until the paid period ends', () => {
    const calculator = new BillingLicenseCalculatorService(
      new BillingPlanCatalogResolver(),
    );
    const { subscription, product } = fixture();
    const end = new Date(Date.now() + 3600000);
    subscription.status = SubscriptionStatus.Cancelled;
    subscription.cancelAtPeriodEnd = true;
    subscription.currentPeriodEnd = end;
    Object.assign(subscription, { nextBillingTime: null });
    const value = calculator.calculate({
      product,
      subscription,
      status: LicenseStatus.Revoked,
    });
    expect(value.status).toBe(LicenseStatus.Active);
    expect(value.validUntil).toEqual(end);
    subscription.currentPeriodEnd = new Date(Date.now() - 1000);
    expect(
      calculator.calculate({
        product,
        subscription,
        status: LicenseStatus.Revoked,
      }).status,
    ).toBe(LicenseStatus.Revoked);
  });
  it('does not grant rights to an immediate cancellation or suspension', () => {
    const calculator = new BillingLicenseCalculatorService(
      new BillingPlanCatalogResolver(),
    );
    const { subscription, product } = fixture();
    subscription.status = SubscriptionStatus.Cancelled;
    subscription.cancelAtPeriodEnd = false;
    subscription.currentPeriodEnd = new Date(Date.now() + 3600000);
    expect(
      calculator.calculate({
        product,
        subscription,
        status: LicenseStatus.Revoked,
      }).status,
    ).toBe(LicenseStatus.Revoked);
    subscription.status = SubscriptionStatus.Suspended;
    subscription.cancelAtPeriodEnd = true;
    expect(
      calculator.calculate({
        product,
        subscription,
        status: LicenseStatus.Suspended,
      }).status,
    ).toBe(LicenseStatus.Suspended);
  });
});

it('a cancellation webhook preserves the stored paid end when PayPal omits the next billing date', async () => {
  const f = fixture();
  const paidEnd = new Date(Date.now() + 3600000);
  f.subscription.currentPeriodEnd = paidEnd;
  f.subscription.cancelAtPeriodEnd = true;
  f.snapshot.status = 'CANCELLED';
  f.snapshot.raw.status = 'CANCELLED';
  delete f.billingInfo.next_billing_time;
  await f.processor.process(f.manager as never, {
    ...f.input,
    eventType: 'BILLING.SUBSCRIPTION.CANCELLED',
    resource: { id: 'I-SUBSCRIPTION' },
  });
  expect(f.subscription.currentPeriodEnd).toEqual(paidEnd);
  expect(f.license.status).toBe(LicenseStatus.Active);
  expect(f.license.validUntil).toEqual(paidEnd);
  expect(BillingLicenseMapper.toResolveDto(f.license, 'medsync').active).toBe(
    true,
  );
});
