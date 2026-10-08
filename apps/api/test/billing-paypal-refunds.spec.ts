import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { BillingAuditService } from '../src/modules/audit';
import {
  BillingLicenseEntity,
  BillingPaymentEntity,
  BillingPaymentRefundEntity,
  BillingProvider,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
  LicenseStatus,
  PaymentStatus,
  SubscriptionAddonStatus,
  SubscriptionStatus,
} from '../src/modules/billing-shared';
import { BillingPaypalRefundsService } from '../src/modules/webhooks/billing-paypal-refunds.service';
import type { BillingWebhookProcessorInput } from '../src/modules/webhooks/types';

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
