import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { BillingAuditService } from '../../../../apps/api/src/modules/audit';
import {
  BillingLicenseEntity,
  BillingPaymentEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingPaymentRefundEntity,
  BillingProvider,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
  LicenseStatus,
  PaymentStatus,
  SubscriptionAddonStatus,
  SubscriptionStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import { BillingLicenseCalculatorService } from '../../../../apps/api/src/modules/licenses';
import { BillingPaypalRefundsService } from '../../../../apps/api/src/modules/webhooks/paypal/billing-paypal-refunds.service';
import type { BillingWebhookProcessorInput } from '../../../../apps/api/src/modules/webhooks/types';

const organizationId = randomUUID();
const subscriptionId = randomUUID();
const paymentId = randomUUID();
const webhookEventId = randomUUID();
const paidAt = new Date(Date.now() - 60_000);
const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function fixture(paymentFound = true) {
  const subscription = {
    id: subscriptionId,
    organizationId,
    status: SubscriptionStatus.Active,
    providerSubscriptionId: 'I-SUBSCRIPTION',
    cancelAtPeriodEnd: false,
    graceUntil: null,
    metadata: {},
  } as BillingSubscriptionEntity;
  const payment = {
    id: paymentId,
    organizationId,
    subscriptionId,
    subscription,
    provider: BillingProvider.Paypal,
    providerCaptureId: 'SALE-ORIGINAL',
    amount: '520.84',
    currency: 'MXN',
    status: PaymentStatus.Paid,
    paidAt,
    periodStart: paidAt,
    periodEnd,
  } as BillingPaymentEntity;
  const license = {
    id: randomUUID(),
    subscriptionId,
    status: LicenseStatus.Active,
    validUntil: periodEnd,
  } as BillingLicenseEntity;
  const addon = {
    id: randomUUID(),
    subscriptionId,
    provider: BillingProvider.Paypal,
    providerSubscriptionId: 'I-ADDON',
    status: SubscriptionAddonStatus.ScheduledCancel,
  } as BillingSubscriptionAddonEntity;
  const savedRefunds: BillingPaymentRefundEntity[] = [];
  const jobs: Record<string, unknown>[] = [];
  const queryCalls: Array<[string, unknown[]]> = [];
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const previousPlan = {
    id: 'plan-a',
    versions: [
      { prices: [{ id: 'price-a', providerPrices: [{ id: 'provider-a' }] }] },
    ],
  };
  const calculator = {
    calculate: jest.fn(
      ({
        subscription: restored,
      }: {
        subscription: BillingSubscriptionEntity;
      }) => ({
        planCode: restored.planCode,
        status: LicenseStatus.Active,
        seatsLimit: 3,
        featuresJson: { 'tier.a': true },
        validUntil: periodEnd,
      }),
    ),
  };
  const repositories = new Map<unknown, Record<string, jest.Mock>>([
    [
      BillingPaymentEntity,
      {
        findOne: jest.fn().mockResolvedValue(payment),
        save: jest.fn((value: BillingPaymentEntity) => value),
      },
    ],
    [
      BillingPaymentRefundEntity,
      {
        create: jest.fn(
          (
            value: Partial<BillingPaymentRefundEntity>,
          ): BillingPaymentRefundEntity =>
            Object.assign(new BillingPaymentRefundEntity(), {
              id: randomUUID(),
              ...value,
            }),
        ),
        findOne: jest.fn(
          ({
            where,
          }: {
            where: {
              provider: BillingProvider;
              providerRefundId: string;
            };
          }): BillingPaymentRefundEntity | null =>
            savedRefunds.find(
              (item) =>
                item.provider === where.provider &&
                item.providerRefundId === where.providerRefundId,
            ) ?? null,
        ),
        find: jest.fn(() => [...savedRefunds]),
        save: jest.fn((value: BillingPaymentRefundEntity) => {
          if (
            savedRefunds.some(
              (item) => item.providerRefundId === value.providerRefundId,
            )
          ) {
            return savedRefunds.find(
              (item) => item.providerRefundId === value.providerRefundId,
            );
          }
          savedRefunds.push(value);
          return value;
        }),
      },
    ],
    [
      BillingSubscriptionEntity,
      {
        findOne: jest.fn().mockResolvedValue(subscription),
        save: jest.fn((value: BillingSubscriptionEntity) => value),
      },
    ],
    [
      BillingLicenseEntity,
      {
        findOne: jest.fn().mockResolvedValue(license),
        save: jest.fn((value: BillingLicenseEntity) => value),
      },
    ],
    [
      BillingSubscriptionAddonEntity,
      {
        find: jest.fn(() => [addon]),
        save: jest.fn((value: BillingSubscriptionAddonEntity) => value),
      },
    ],
  ]);
  repositories.set(BillingPlanEntity, {
    findOne: jest.fn().mockResolvedValue(previousPlan),
  });
  repositories.set(BillingProductEntity, {
    findOne: jest.fn().mockResolvedValue({ id: 'product', code: 'balanz' }),
  });
  const manager = {
    query: jest.fn((sql: string, parameters?: unknown[]) => {
      queryCalls.push([sql, parameters ?? []]);
      if (sql.startsWith('SELECT id FROM payments')) {
        return paymentFound ? [{ id: paymentId }] : [];
      }
      if (sql.startsWith('INSERT INTO paypal_cancellation_jobs')) {
        jobs.push({});
        return [];
      }
      throw new Error('Unexpected query: ' + sql);
    }),
    getRepository: (entity: unknown) => {
      const repository = repositories.get(entity);
      if (!repository) throw new Error('Unexpected repository');
      return repository;
    },
  } as unknown as EntityManager;
  const service = new BillingPaypalRefundsService(
    audit as unknown as BillingAuditService,
    calculator as unknown as BillingLicenseCalculatorService,
  );
  const input = (id: string, total: string): BillingWebhookProcessorInput => ({
    eventId: webhookEventId,
    providerEventId: 'WH-' + id,
    eventType: 'PAYMENT.SALE.REFUNDED',
    resource: {
      id,
      sale_id: 'SALE-ORIGINAL',
      state: 'completed',
      create_time: new Date().toISOString(),
      amount: { total, currency: 'MXN' },
    },
  });
  return {
    service,
    manager,
    payment,
    subscription,
    license,
    addon,
    savedRefunds,
    jobs,
    queryCalls,
    audit,
    input,
    repositories,
    calculator,
  };
}

it('records partial refunds once and keeps the paid access active', async () => {
  const f = fixture();
  await f.service.process(f.manager, f.input('REFUND-1', '200.00'));
  await f.service.process(f.manager, f.input('REFUND-1', '200.00'));

  expect(f.savedRefunds).toHaveLength(1);
  expect(f.payment.status).toBe(PaymentStatus.Paid);
  expect(f.license.status).toBe(LicenseStatus.Active);
  expect(f.jobs).toHaveLength(0);
  expect(f.queryCalls[0]).toEqual([
    expect.stringContaining('provider_capture_id=$2'),
    [BillingProvider.Paypal, 'SALE-ORIGINAL'],
  ]);
});

it('leaves a refund retryable when its sale_id does not match a payment', async () => {
  const f = fixture(false);
  const result = await f.service.process(
    f.manager,
    f.input('REFUND-MISSING', '520.84'),
  );

  expect(result).toMatchObject({
    processingStatus: 'failed',
    note: 'Payment not found',
  });
  expect(f.savedRefunds).toHaveLength(0);
  expect(f.payment.status).toBe(PaymentStatus.Paid);
});

it('accumulates distinct partial refunds and revokes when they reach the original amount', async () => {
  const f = fixture();
  await f.service.process(f.manager, f.input('REFUND-1A', '200.00'));
  await f.service.process(f.manager, f.input('REFUND-1B', '320.84'));

  expect(f.savedRefunds).toHaveLength(2);
  expect(f.payment.status).toBe(PaymentStatus.Refunded);
  expect(f.subscription.status).toBe(SubscriptionStatus.Cancelled);
  expect(f.jobs).toHaveLength(2);
});

it('revokes a fully refunded current period and queues the plan and scheduled addon cancellations', async () => {
  const f = fixture();
  await f.service.process(f.manager, f.input('REFUND-2', '520.84'));

  expect(f.savedRefunds).toHaveLength(1);
  expect(f.payment.status).toBe(PaymentStatus.Refunded);
  expect(f.subscription.status).toBe(SubscriptionStatus.Cancelled);
  expect(f.subscription.metadata).toHaveProperty('refundRevocation');
  expect(f.license.status).toBe(LicenseStatus.Revoked);
  expect(f.addon.status).toBe(SubscriptionAddonStatus.Cancelled);
  expect(f.jobs).toHaveLength(2);
});

it('keeps access for a full refund from a prior period', async () => {
  const f = fixture();
  f.payment.periodEnd = new Date(Date.now() - 1_000);
  await f.service.process(f.manager, f.input('REFUND-3', '520.84'));

  expect(f.payment.status).toBe(PaymentStatus.Refunded);
  expect(f.subscription.status).toBe(SubscriptionStatus.Active);
  expect(f.license.status).toBe(LicenseStatus.Active);
  expect(f.jobs).toHaveLength(0);
});

it('fails a refund whose currency differs from the payment', async () => {
  const f = fixture();
  const payload = f.input('REFUND-4', '520.84');
  payload.resource.amount = { total: '520.84', currency: 'USD' };
  const result = await f.service.process(f.manager, payload);

  expect(result).toMatchObject({
    processingStatus: 'failed',
    note: 'PayPal refund currency mismatch',
  });
  expect(f.savedRefunds).toHaveLength(0);
});

it('records a full refund with an unknown period for manual review without cancelling access', async () => {
  const f = fixture();
  f.payment.periodStart = null;
  f.payment.periodEnd = null;
  await f.service.process(f.manager, f.input('REFUND-5', '520.84'));

  expect(f.payment.status).toBe(PaymentStatus.Refunded);
  expect(f.subscription.status).toBe(SubscriptionStatus.Active);
  expect(f.jobs).toHaveLength(0);
  expect(f.audit.record).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'billing.refund.period_review_required',
    }),
  );
});

it('audits refund revocation without reporting an unchanged revoked license', async () => {
  const f = fixture();
  f.license.status = LicenseStatus.Revoked;
  await f.service.process(f.manager, f.input('REFUND-6', '520.84'));

  expect(f.audit.record).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'billing.subscription.refund_revoked' }),
  );
  expect(f.audit.record).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: 'billing.license.status_changed' }),
  );
});

function prorationFixture() {
  const f = fixture();
  f.payment.metadata = {
    operation: 'plan_change_proration',
    checkoutId: 'checkout-b',
    previousPlan: {
      planId: 'plan-a',
      planCode: 'a',
      planPriceId: 'price-a',
      planPriceCode: 'monthly',
      providerPriceId: 'provider-a',
      legalAcceptanceId: 'legal-a',
      acceptedAt: paidAt.toISOString(),
      legalSnapshotHash: 'hash-a',
    },
  };
  f.subscription.planCode = 'b';
  f.subscription.metadata = {
    pendingPlanChange: {
      checkoutId: 'checkout-b',
      state: 'effective',
      effectiveAt: paidAt.toISOString(),
      captureId: 'SALE-ORIGINAL',
      capturedAt: paidAt.toISOString(),
    },
  };
  f.license.planCode = 'b';
  const input = f.input('REFUND-CAPTURE', f.payment.amount);
  input.eventType = 'PAYMENT.CAPTURE.REFUNDED';
  input.resource = {
    id: 'REFUND-CAPTURE',
    status: 'COMPLETED',
    create_time: new Date().toISOString(),
    amount: { value: f.payment.amount, currency_code: 'MXN' },
    links: [
      {
        rel: 'up',
        href: 'https://api.paypal.com/v2/payments/captures/SALE-ORIGINAL',
      },
    ],
  };
  return { ...f, captureInput: input };
}

it('restores the paid original plan after a full Orders proration refund without cancelling renewal', async () => {
  const f = prorationFixture();
  await f.service.process(f.manager, f.captureInput);
  await f.service.process(f.manager, f.captureInput);
  expect(f.savedRefunds).toHaveLength(1);
  expect(f.payment.status).toBe(PaymentStatus.Refunded);
  expect(f.subscription).toMatchObject({
    status: SubscriptionStatus.Active,
    planCode: 'a',
    legalAcceptanceId: 'legal-a',
    legalSnapshotHash: 'hash-a',
  });
  expect(f.subscription.metadata.pendingPlanChange).toMatchObject({
    state: 'scheduled',
    effectiveAt: periodEnd.toISOString(),
    proration: { refundedAt: f.captureInput.resource.create_time },
  });
  expect(f.license).toMatchObject({
    status: LicenseStatus.Active,
    planCode: 'a',
    seatsLimit: 3,
  });
  expect(f.jobs).toHaveLength(0);
  expect(f.addon.status).toBe(SubscriptionAddonStatus.ScheduledCancel);
});

it('keeps upgraded access on partial Orders refunds and rejects spoofed capture links', async () => {
  const f = prorationFixture();
  f.captureInput.resource.amount = { value: '100.00', currency_code: 'MXN' };
  await f.service.process(f.manager, f.captureInput);
  expect(f.subscription.planCode).toBe('b');
  expect(f.calculator.calculate).not.toHaveBeenCalled();
  f.captureInput.resource.links = [
    {
      rel: 'up',
      href: 'https://example.com/v2/payments/captures/SALE-ORIGINAL',
    },
  ];
  expect(await f.service.process(f.manager, f.captureInput)).toMatchObject({
    processingStatus: 'failed',
  });
});

it('does not roll back a later upgrade when an older proration is refunded', async () => {
  const f = prorationFixture();
  f.subscription.metadata.pendingPlanChange = {
    ...(f.subscription.metadata.pendingPlanChange as object),
    checkoutId: 'later-checkout',
  };
  await f.service.process(f.manager, f.captureInput);
  expect(f.payment.status).toBe(PaymentStatus.Refunded);
  expect(f.subscription.planCode).toBe('b');
  expect(f.jobs).toHaveLength(0);
});

it('restores original paid access once after reversal of the prorated capture', async () => {
  const f = prorationFixture();
  const input = {
    ...f.captureInput,
    eventType: 'PAYMENT.CAPTURE.REVERSED',
    resource: { id: 'SALE-ORIGINAL' },
  };
  await f.service.reverseCapture(f.manager, input);
  await f.service.reverseCapture(f.manager, input);
  expect(f.payment.status).toBe(PaymentStatus.Reversed);
  expect(f.subscription.planCode).toBe('a');
  expect(f.jobs).toHaveLength(0);
  expect(f.calculator.calculate).toHaveBeenCalledTimes(1);
});

it('does not revive an upgrade renewal when its proration is refunded after cancellation', async () => {
  const f = prorationFixture();
  f.subscription.cancelAtPeriodEnd = true;
  await f.service.process(f.manager, f.captureInput);
  expect(f.subscription.planCode).toBe('a');
  expect(f.subscription.metadata.pendingPlanChange).toMatchObject({
    state: 'failed',
  });
  expect(f.subscription.cancelAtPeriodEnd).toBe(true);
});
