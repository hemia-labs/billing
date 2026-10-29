import {
  BillingFeatureDefinitionEntity,
  BillingCheckoutSessionEntity,
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
  it('reconciles the consented future target before validating its first payment so the old renewal price cannot block paid benefits', async () => {
    const f = fixture(SubscriptionStatus.Pending);
    const boundary = new Date(f.now.getTime() - 1000).toISOString();
    const targetPrice = Object.assign(new BillingPlanPriceEntity(), {
      id: 'target-price',
      code: 'target-monthly',
      amount: '299.00',
      currency: 'MXN',
    });
    const targetPlan = Object.assign(new BillingPlanEntity(), {
      ...f.subscription.plan,
      id: 'target-plan',
      code: 'professional',
      versions: f.subscription.plan.versions.map((version) => ({
        ...version,
        prices: [targetPrice],
      })),
    });
    const checkout = {
      id: 'future-change',
      organizationId: f.subscription.organizationId,
      productCode: f.subscription.productCode,
      planId: targetPlan.id,
      plan: targetPlan,
      planPriceId: targetPrice.id,
      planPrice: targetPrice,
      planPriceCode: targetPrice.code,
      providerPriceId: 'target-provider-price',
      providerPrice: { providerPriceId: 'P-TARGET' },
      metadata: { subscriptionId: f.subscription.id },
    };
    f.subscription.metadata.renewalResume = {
      state: 'scheduled',
      sourceSubscriptionId: 'old-paid-source',
      effectiveAt: boundary,
      amountDueNow: '0.00',
      recurringAmount: '499.00',
      currency: 'MXN',
      providerPlanId: 'P-OLD',
    };
    f.subscription.metadata.renewalPlanChange = {
      state: 'awaiting_approval',
      sourceSubscriptionId: 'old-paid-source',
      renewalSubscriptionId: f.subscription.id,
      checkoutId: checkout.id,
      targetProviderPlanId: 'P-TARGET',
      originalProviderPlanId: 'P-OLD',
      effectiveAt: boundary,
    };
    f.snapshot.planId = 'P-TARGET';
    f.input.resource.amount.total = '299.00';
    const manager = {
      getRepository: (entity: unknown) =>
        entity === BillingCheckoutSessionEntity
          ? {
              findOne: () => Promise.resolve(checkout),
              update: jest.fn(() => Promise.resolve()),
            }
          : f.manager.getRepository(entity),
    };
    await f.processor.process(manager as never, f.input);
    expect(f.subscription).toMatchObject({
      status: SubscriptionStatus.Active,
      planCode: 'professional',
      metadata: {
        renewalResume: {
          state: 'effective',
          recurringAmount: '299.00',
          providerPlanId: 'P-TARGET',
        },
        renewalPlanChange: { state: 'effective' },
      },
    });
    expect(f.payments.save.mock.calls[0][0]).toMatchObject({
      status: PaymentStatus.Paid,
      amount: '299.00',
    });
    expect(f.license).toMatchObject({
      status: LicenseStatus.Active,
      planCode: 'professional',
    });
  });
  it('future replacement approval preserves the separately paid source license until its new cycle is paid', async () => {
    const f = fixture(SubscriptionStatus.Pending);
    const paidLicense = structuredClone(f.license);
    f.subscription.metadata.renewalResume = {
      state: 'awaiting_approval',
      sourceSubscriptionId: 'previous-paid-subscription',
      effectiveAt: f.nextBilling.toISOString(),
      amountDueNow: '0.00',
      recurringAmount: '499.00',
      currency: 'MXN',
    };
    delete f.billingInfo.last_payment;
    await f.processor.process(f.manager as never, {
      ...f.input,
      eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: f.subscription.providerSubscriptionId },
    });
    expect(f.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(f.subscription.metadata.renewalResume).toMatchObject({
      state: 'scheduled',
    });
    expect(f.licenses.save).not.toHaveBeenCalled();
    expect(structuredClone(f.license)).toEqual(paidLicense);
    expect(f.payments.save).not.toHaveBeenCalled();
  });
  it.each([
    'early',
    'amount',
    'currency',
    'missing-time',
    'invalid-time',
    'valid',
  ])(
    'replacement payment %s records money and grants only the contracted future cycle',
    async (mode) => {
      const f = fixture(SubscriptionStatus.Pending);
      const paidLicense = structuredClone(f.license);
      const boundary =
        mode === 'early' ? f.nextBilling : new Date(f.now.getTime() - 1000);
      f.snapshot.planId = 'P-FUTURE';
      f.subscription.metadata.renewalResume = {
        state: 'scheduled',
        sourceSubscriptionId: 'previous-paid-subscription',
        effectiveAt: boundary.toISOString(),
        providerPlanId: 'P-FUTURE',
        amountDueNow: '0.00',
        recurringAmount: '499.00',
        currency: 'MXN',
      };
      if (mode === 'amount') f.input.resource.amount.total = '498.00';
      if (mode === 'currency') f.input.resource.amount.currency = 'USD';
      if (mode === 'missing-time')
        delete (f.input.resource as { create_time?: string }).create_time;
      if (mode === 'invalid-time') f.input.resource.create_time = 'invalid';
      await f.processor.process(f.manager as never, f.input);
      expect(f.payments.save).toHaveBeenCalled();
      if (mode === 'valid') {
        expect(f.subscription.status).toBe(SubscriptionStatus.Active);
        expect(f.subscription.metadata.renewalResume).toMatchObject({
          state: 'effective',
          paidCaptureId: 'SALE-PAYMENT-ID',
        });
        await f.processor.process(f.manager as never, f.input);
        expect(f.subscription.metadata.renewalResume).toMatchObject({
          state: 'effective',
          paidCaptureId: 'SALE-PAYMENT-ID',
        });
      } else {
        expect(f.subscription.status).toBe(SubscriptionStatus.Pending);
        expect(f.licenses.save).not.toHaveBeenCalled();
        expect(structuredClone(f.license)).toEqual(paidLicense);
        expect(f.payments.save.mock.calls[0][0].metadata).toMatchObject({
          renewalResumeReview: { state: 'required' },
        });
      }
    },
  );
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

it('propagates the current contractual plan code when renewing an existing license', async () => {
  const f = fixture();
  f.license.planCode = 'premium';
  f.subscription.planCode = 'basic';
  await f.processor.process(f.manager as never, f.input);
  expect(f.license.planCode).toBe('basic');
  expect(f.licenses.save).toHaveBeenCalledWith(
    expect.objectContaining({ planCode: 'basic' }),
  );
});

function abandonedFixture() {
  const f = fixture(SubscriptionStatus.Cancelled);
  f.subscription.metadata = {
    checkoutAbandonment: {
      checkoutId: 'checkout-old',
      attemptId: 'attempt-old',
      abandonedAt: new Date().toISOString(),
      actorUserId: 'buyer',
      providerSubscriptionId: 'I-SUBSCRIPTION',
      providerCancellation: {
        state: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(0).toISOString(),
      },
    },
  };
  f.subscription.currentPeriodStart = null;
  f.subscription.currentPeriodEnd = null;
  f.subscription.cancelAtPeriodEnd = false;
  f.subscription.nextBillingTime = null;
  f.license.status = LicenseStatus.Revoked;
  f.subscriptions.findOne.mockResolvedValue(f.subscription);
  return f;
}
it.each([
  'BILLING.SUBSCRIPTION.CREATED',
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
])(
  'keeps an abandoned contract terminal for %s and duplicate out-of-order events',
  async (eventType) => {
    const f = abandonedFixture();
    const input = { ...f.input, eventType, resource: { id: 'I-SUBSCRIPTION' } };
    await f.processor.process(f.manager as never, input);
    await f.processor.process(f.manager as never, input);
    expect(f.subscription.status).toBe(SubscriptionStatus.Cancelled);
    expect(f.subscription.currentPeriodEnd).toBeNull();
    expect(f.subscription.nextBillingTime).toBeNull();
    expect(f.licenses.save).not.toHaveBeenCalled();
    expect(f.licenses.create).not.toHaveBeenCalled();
    expect(f.subscription.metadata.checkoutAbandonment).toMatchObject({
      providerCancellation: { state: 'pending' },
    });
  },
);
it('records a late real payment with refund review while duplicates, reversals and stale paid events cannot grant access', async () => {
  const f = abandonedFixture();
  await f.processor.process(f.manager as never, f.input);
  await f.processor.process(f.manager as never, f.input);
  expect(f.payments.create).toHaveBeenCalledTimes(1);
  expect(f.payments.save.mock.calls[0][0]).toMatchObject({
    status: PaymentStatus.Paid,
    metadata: {
      refundReview: { state: 'required', reason: 'abandoned_checkout' },
    },
  });
  await f.processor.process(f.manager as never, {
    ...f.input,
    eventType: 'PAYMENT.SALE.REVERSED',
  });
  expect(f.subscriptions.findOne).toHaveBeenCalledWith(
    expect.objectContaining({
      lock: expect.objectContaining({ mode: 'pessimistic_write' }) as unknown,
    }),
  );
  await f.processor.process(f.manager as never, f.input);
  expect(f.subscription.status).toBe(SubscriptionStatus.Cancelled);
  expect(f.licenses.save).not.toHaveBeenCalled();
  expect(f.payments.save.mock.calls.at(-1)![0].status).toBe(
    PaymentStatus.Reversed,
  );
});

it('calculator and license reads cannot grant abandoned paid-through access even with stale active license flags', () => {
  const f = abandonedFixture();
  f.subscription.cancelAtPeriodEnd = true;
  f.subscription.currentPeriodEnd = f.nextBilling;
  f.license.status = LicenseStatus.Active;
  f.license.validUntil = f.nextBilling;
  f.license.subscription = f.subscription;
  const calculated = new BillingLicenseCalculatorService(
    new BillingPlanCatalogResolver(),
  ).calculate({
    subscription: f.subscription,
    license: f.license,
    product: f.product,
    status: LicenseStatus.Active,
  });
  expect(calculated.status).toBe(LicenseStatus.Revoked);
  expect(BillingLicenseMapper.toResolveDto(f.license, 'medsync').active).toBe(
    false,
  );
});

it('simulates Nov 26 renewal locally: Despacho access before the boundary, one 499 MXN payment for Profesional and idempotent event replay', async () => {
  jest.useFakeTimers();
  const boundary = new Date('2026-11-26T10:00:00.000Z');
  const nextCycle = new Date('2026-12-26T10:00:00.000Z');
  jest.setSystemTime(new Date(boundary.getTime() - 1));
  try {
    const f = fixture(SubscriptionStatus.Pending);
    f.product.code = 'balanz_cfdi';
    f.subscription.productCode = f.product.code;
    const source = Object.assign(new BillingSubscriptionEntity(), {
      id: 'local-paid-source',
      organizationId: f.subscription.organizationId,
      productCode: f.product.code,
      planCode: 'balanz_despacho',
      status: SubscriptionStatus.Cancelled,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: boundary,
      metadata: {},
    });
    const sourceLicense = Object.assign(new BillingLicenseEntity(), {
      id: 'local-despacho-license',
      subscriptionId: source.id,
      subscription: source,
      status: LicenseStatus.Active,
      productCode: f.product.code,
      planCode: source.planCode,
      validUntil: boundary,
      featuresJson: {},
      seatsLimit: 2,
    });
    const licenses = new Map<string, BillingLicenseEntity>([
      [source.id, sourceLicense],
    ]);
    const price = Object.assign(new BillingPlanPriceEntity(), {
      id: 'local-professional-price',
      code: 'precio_mensual',
      amount: '499.00',
      currency: 'MXN',
    });
    const plan = Object.assign(new BillingPlanEntity(), {
      ...f.subscription.plan,
      id: 'local-professional-plan',
      code: 'balanz_profesional',
      versions: f.subscription.plan.versions.map((version) => ({
        ...version,
        prices: [price],
      })),
    });
    Object.assign(f.subscription, {
      id: 'local-future-subscription',
      providerSubscriptionId: 'I-LOCAL-FUTURE',
      plan,
      planId: plan.id,
      planCode: plan.code,
      planPrice: price,
      planPriceId: price.id,
      planPriceCode: price.code,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextBillingTime: null,
    });
    f.snapshot.id = f.subscription.providerSubscriptionId;
    f.snapshot.planId = 'P-LOCAL-PROFESSIONAL';
    f.billingInfo.next_billing_time = boundary.toISOString();
    delete f.billingInfo.last_payment;
    const checkout = {
      id: 'local-future-change',
      organizationId: f.subscription.organizationId,
      productCode: f.subscription.productCode,
      planId: plan.id,
      plan,
      planPriceId: price.id,
      planPrice: price,
      planPriceCode: price.code,
      providerPriceId: 'local-professional-provider-price',
      providerPrice: { providerPriceId: f.snapshot.planId },
      metadata: { subscriptionId: f.subscription.id },
    };
    f.subscription.metadata.renewalResume = {
      state: 'scheduled',
      sourceSubscriptionId: source.id,
      effectiveAt: boundary.toISOString(),
      amountDueNow: '0.00',
      recurringAmount: '499.00',
      currency: 'MXN',
      providerPlanId: f.snapshot.planId,
    };
    f.subscription.metadata.renewalPlanChange = {
      state: 'scheduled',
      sourceSubscriptionId: source.id,
      renewalSubscriptionId: f.subscription.id,
      checkoutId: checkout.id,
      targetProviderPlanId: f.snapshot.planId,
      effectiveAt: boundary.toISOString(),
    };
    const oldPayments = [
      Object.assign(new BillingPaymentEntity(), {
        providerCaptureId: 'LOCAL-OLD-INITIAL',
        subscriptionId: source.id,
        status: PaymentStatus.Paid,
        amount: '499.00',
        currency: 'MXN',
        metadata: {},
      }),
      Object.assign(new BillingPaymentEntity(), {
        providerCaptureId: 'LOCAL-OLD-PRORATION',
        subscriptionId: source.id,
        status: PaymentStatus.Paid,
        amount: '499.93',
        currency: 'MXN',
        metadata: {},
      }),
    ];
    const payments = new Map(
      oldPayments.map((payment) => [payment.providerCaptureId, payment]),
    );
    const paymentRepository = {
      findOne: jest.fn(
        ({
          where,
        }: {
          where: { providerCaptureId?: string; providerPaymentId?: string };
        }) =>
          Promise.resolve(payments.get(where.providerCaptureId ?? '') ?? null),
      ),
      create: jest.fn((value: Partial<BillingPaymentEntity>) =>
        Object.assign(
          new BillingPaymentEntity(),
          { id: 'local-renewal-payment' },
          value,
        ),
      ),
      save: jest.fn((value: BillingPaymentEntity) => {
        payments.set(value.providerCaptureId!, value);
        return Promise.resolve(value);
      }),
    };
    const licenseRepository = {
      findOne: ({ where }: { where: { subscriptionId: string } }) =>
        Promise.resolve(licenses.get(where.subscriptionId) ?? null),
      create: (value: Partial<BillingLicenseEntity>) =>
        Object.assign(
          new BillingLicenseEntity(),
          { id: 'local-professional-license', subscription: f.subscription },
          value,
        ),
      save: jest.fn((value: BillingLicenseEntity) => {
        licenses.set(value.subscriptionId!, value);
        return Promise.resolve(value);
      }),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === BillingPaymentEntity
          ? paymentRepository
          : entity === BillingLicenseEntity
            ? licenseRepository
            : entity === BillingCheckoutSessionEntity
              ? {
                  findOne: () => Promise.resolve(checkout),
                  update: () => Promise.resolve(undefined),
                }
              : f.manager.getRepository(entity),
    };
    const before = structuredClone({ source, sourceLicense, oldPayments });
    const approval = {
      ...f.input,
      eventId: 'LOCAL-ACTIVATION',
      providerEventId: 'LOCAL-WH-ACTIVATION',
      eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: f.subscription.providerSubscriptionId },
    };
    await f.processor.process(manager as never, approval);
    expect(
      BillingLicenseMapper.toResolveDto(sourceLicense, f.product.code).active,
    ).toBe(true);
    expect(f.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(licenses.has(f.subscription.id)).toBe(false);
    expect(payments.size).toBe(2);
    jest.setSystemTime(boundary);
    await f.processor.process(manager as never, {
      ...approval,
      eventId: 'LOCAL-UNPAID-BOUNDARY',
    });
    expect(
      BillingLicenseMapper.toResolveDto(sourceLicense, f.product.code).active,
    ).toBe(false);
    expect(licenses.has(f.subscription.id)).toBe(false);
    expect(payments.size).toBe(2);
    f.billingInfo.last_payment = {
      time: boundary.toISOString(),
      amount: { value: '499.00', currency_code: 'MXN' },
    };
    f.billingInfo.next_billing_time = nextCycle.toISOString();
    const paid = {
      ...f.input,
      eventId: 'LOCAL-EVENT-PAID',
      providerEventId: 'LOCAL-WH-PAID',
      resource: {
        id: 'LOCAL-RENEWAL-CAPTURE-499',
        billing_agreement_id: f.subscription.providerSubscriptionId,
        amount: { total: '499.00', currency: 'MXN' },
        create_time: boundary.toISOString(),
      },
    };
    await f.processor.process(manager as never, paid);
    await f.processor.process(manager as never, paid);
    await f.processor.process(manager as never, {
      ...paid,
      eventId: 'LOCAL-OTHER-EVENT-SAME-CAPTURE',
      providerEventId: 'LOCAL-OTHER-WH-SAME-CAPTURE',
    });
    expect(paymentRepository.create).toHaveBeenCalledTimes(1);
    expect(
      f.audit.record.mock.calls.filter(
        ([entry]) => entry.action === 'billing.payment.created',
      ),
    ).toHaveLength(1);
    expect(payments.size).toBe(3);
    expect(payments.get('LOCAL-RENEWAL-CAPTURE-499')).toMatchObject({
      subscriptionId: f.subscription.id,
      status: PaymentStatus.Paid,
      amount: '499.00',
      currency: 'MXN',
    });
    expect(f.subscription).toMatchObject({
      status: SubscriptionStatus.Active,
      planCode: 'balanz_profesional',
      currentPeriodStart: boundary,
      currentPeriodEnd: nextCycle,
      metadata: {
        renewalResume: {
          state: 'effective',
          paidCaptureId: 'LOCAL-RENEWAL-CAPTURE-499',
        },
        renewalPlanChange: { state: 'effective' },
      },
    });
    const professionalLicense = licenses.get(f.subscription.id)!;
    expect(professionalLicense).toMatchObject({
      status: LicenseStatus.Active,
      planCode: 'balanz_profesional',
      validUntil: nextCycle,
    });
    expect(
      BillingLicenseMapper.toResolveDto(professionalLicense, f.product.code)
        .active,
    ).toBe(true);
    expect(structuredClone({ source, sourceLicense, oldPayments })).toEqual(
      before,
    );
  } finally {
    jest.useRealTimers();
  }
});
