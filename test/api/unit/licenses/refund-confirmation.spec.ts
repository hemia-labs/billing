import type { EntityManager } from 'typeorm';
import {
  BillingPaymentEntity,
  BillingPaymentRefundEntity,
  BillingProvider,
  BillingSubscriptionEntity,
  BillingWebhookEventEntity,
  LicenseStatus,
  PaymentStatus,
  SubscriptionStatus,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import { refundConfirmation } from '../../../../apps/api/src/modules/licenses/refund-confirmation';
import { BillingSnapshotsService } from '../../../../apps/api/src/modules/licenses/billing-snapshots.service';
import type { BillingLicenseResolveResponseDto } from '../../../../apps/api/src/modules/licenses/dtos';

function fixture() {
  const refundedAt = new Date('2026-11-12T16:00:00Z');
  const subscription = Object.assign(new BillingSubscriptionEntity(), {
    id: '22222222-2222-4222-8222-222222222222',
    organizationId: '11111111-1111-4111-8111-111111111111',
    productCode: 'medsync',
    provider: BillingProvider.Paypal,
    status: SubscriptionStatus.Cancelled,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date('2026-12-01T12:00:00Z'),
    updatedAt: refundedAt,
    metadata: { secret: 'never expose' },
  });
  const payment = Object.assign(new BillingPaymentEntity(), {
    id: '33333333-3333-4333-8333-333333333333',
    organizationId: subscription.organizationId,
    subscriptionId: subscription.id,
    provider: BillingProvider.Paypal,
    status: PaymentStatus.Refunded,
    amount: '499.00',
    currency: 'MXN',
    providerCaptureId: 'SALE-1',
    periodStart: new Date('2026-11-01T12:00:00Z'),
    periodEnd: subscription.currentPeriodEnd,
    metadata: {},
  });
  const refund = Object.assign(new BillingPaymentRefundEntity(), {
    id: '44444444-4444-4444-8444-444444444444',
    provider: BillingProvider.Paypal,
    providerRefundId: 'REFUND-FINAL',
    paymentId: payment.id,
    webhookEventId: '55555555-5555-4555-8555-555555555555',
    amount: payment.amount,
    currency: payment.currency,
    refundedAt,
  });
  const resource: Record<string, unknown> = {
    id: refund.providerRefundId,
    sale_id: payment.providerCaptureId,
    state: 'completed',
    amount: { total: refund.amount, currency: refund.currency },
    create_time: refundedAt.toISOString(),
  };
  const event = Object.assign(new BillingWebhookEventEntity(), {
    id: refund.webhookEventId,
    provider: BillingProvider.Paypal,
    providerConnectionId: null,
    eventType: 'PAYMENT.SALE.REFUNDED',
    resourceId: refund.providerRefundId,
    verificationStatus: WebhookVerificationStatus.Verified,
    processingStatus: WebhookProcessingStatus.Processed,
    requiresManualReview: false,
    payloadJson: { resource, credentials: 'never expose' },
  });
  const marker: Record<string, unknown> = {
    refundId: refund.providerRefundId,
    paymentId: payment.id,
    periodStart: payment.periodStart.toISOString(),
    periodEnd: payment.periodEnd.toISOString(),
  };
  subscription.metadata.refundRevocation = marker;
  const license = {
    active: false,
    licenseStatus: LicenseStatus.Revoked,
    productCode: subscription.productCode,
    subscriptionId: subscription.id,
    validUntil: refundedAt.toISOString(),
    billing: {
      baseMonthly: '499.00',
      addonsMonthly: '100.00',
      totalMonthly: '599.00',
      currency: 'MXN',
    },
  } as BillingLicenseResolveResponseDto;
  const refunds = [refund];
  const events = [event];
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === BillingPaymentEntity)
        return { findOneBy: jest.fn(() => Promise.resolve(payment)) };
      if (entity === BillingPaymentRefundEntity)
        return { find: jest.fn(() => Promise.resolve(refunds)) };
      if (entity === BillingWebhookEventEntity)
        return {
          findOneBy: jest.fn(({ id }: { id: string }) =>
            Promise.resolve(events.find((entry) => entry.id === id) ?? null),
          ),
        };
      if (entity === BillingSubscriptionEntity)
        return { find: jest.fn(() => Promise.resolve([subscription])) };
      throw new Error('Unexpected repository');
    }),
  } as unknown as EntityManager;
  const confirmedAt = new Date('2026-11-12T16:01:00Z');
  return {
    subscription,
    payment,
    refund,
    event,
    marker,
    license,
    resource,
    refunds,
    events,
    manager,
    confirmedAt,
    confirm: () =>
      refundConfirmation(manager, subscription, license, confirmedAt),
  };
}
type Fixture = ReturnType<typeof fixture>;

describe('authoritative full current-period refund confirmation', () => {
  it('exposes only completed refund facts with a provider refund reference', async () => {
    const f = fixture();
    expect(await f.confirm()).toEqual({
      status: 'completed',
      type: 'full_current_period',
      organizationId: f.subscription.organizationId,
      productCode: 'medsync',
      subscriptionId: f.subscription.id,
      paymentId: f.payment.id,
      refundId: 'REFUND-FINAL',
      amount: '499.00',
      currency: 'MXN',
      refundedAt: '2026-11-12T16:00:00.000Z',
    });
  });

  it('preserves existing billing amounts in the central snapshot', async () => {
    const f = fixture();
    const runner = {
      manager: f.manager,
      connect: jest.fn(),
      release: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      query: jest.fn((sql: string) =>
        Promise.resolve(
          sql.includes('nextval')
            ? [{ revision: '42', confirmedAt: f.confirmedAt }]
            : [],
        ),
      ),
    };
    const service = new BillingSnapshotsService(
      { createQueryRunner: () => runner } as never,
      { resolveLicense: () => Promise.resolve(f.license) } as never,
    );
    const snapshot = await service.current(
      f.subscription.organizationId,
      'medsync',
    );
    expect(snapshot.license.billing).toEqual({
      ...f.license.billing,
      refundConfirmation: await f.confirm(),
    });
    expect(JSON.stringify(snapshot)).not.toContain('never expose');
  });

  it('preserves refund proof after the provider cancellation refreshes the revoked license expiry', async () => {
    const f = fixture();
    const refunded = await f.confirm();
    expect(refunded).toMatchObject({
      status: 'completed',
      type: 'full_current_period',
    });

    // BILLING.SUBSCRIPTION.CANCELLED keeps the revocation but recalculates this date.
    f.license.validUntil = f.subscription.currentPeriodEnd.toISOString();
    f.subscription.updatedAt = new Date('2026-11-12T16:00:30Z');
    expect(await f.confirm()).toEqual(refunded);

    // A refund for the previous paid period still cannot confirm the new period.
    f.subscription.currentPeriodEnd = new Date('2027-01-01T12:00:00Z');
    f.license.validUntil = f.subscription.currentPeriodEnd.toISOString();
    expect(await f.confirm()).toBeUndefined();
  });

  it('requires every split refund to be verified before confirming the aggregate total', async () => {
    const f = fixture();
    f.refund.amount = '299.00';
    f.resource.amount = { total: '299.00', currency: 'MXN' };
    const earlier = Object.assign(new BillingPaymentRefundEntity(), f.refund, {
      id: '66666666-6666-4666-8666-666666666666',
      providerRefundId: 'REFUND-FIRST',
      webhookEventId: '77777777-7777-4777-8777-777777777777',
      amount: '200.00',
      refundedAt: new Date('2026-11-11T16:00:00Z'),
    });
    f.refunds.push(earlier);
    const event = Object.assign(new BillingWebhookEventEntity(), f.event, {
      id: earlier.webhookEventId,
      resourceId: earlier.providerRefundId,
      payloadJson: {
        resource: {
          ...f.resource,
          id: earlier.providerRefundId,
          amount: { total: '200.00', currency: 'MXN' },
          create_time: earlier.refundedAt.toISOString(),
        },
      },
    });
    f.events.push(event);
    expect(await f.confirm()).toMatchObject({
      amount: '499.00',
      refundId: 'REFUND-FINAL',
    });
    event.processingStatus = WebhookProcessingStatus.Pending;
    expect(await f.confirm()).toBeUndefined();
  });

  it.each([
    [
      'active license',
      (f: Fixture) => {
        f.license.active = true;
      },
    ],
    [
      'suspended license',
      (f: Fixture) => {
        f.license.licenseStatus = LicenseStatus.Suspended;
      },
    ],
    [
      'grace license',
      (f: Fixture) => {
        f.license.licenseStatus = LicenseStatus.Grace;
      },
    ],
    [
      'other subscription license',
      (f: Fixture) => {
        f.license.subscriptionId = 'other';
      },
    ],
    [
      'other product license',
      (f: Fixture) => {
        f.license.productCode = 'other';
      },
    ],
    [
      'active subscription',
      (f: Fixture) => {
        f.subscription.status = SubscriptionStatus.Active;
      },
    ],
    [
      'cancellation still scheduled',
      (f: Fixture) => {
        f.subscription.cancelAtPeriodEnd = true;
      },
    ],
    [
      'missing revocation marker',
      (f: Fixture) => {
        delete f.subscription.metadata.refundRevocation;
      },
    ],
    [
      'abandoned checkout',
      (f: Fixture) => {
        f.subscription.metadata.checkoutAbandonment = {};
      },
    ],
    [
      'other organization payment',
      (f: Fixture) => {
        f.payment.organizationId = 'other';
      },
    ],
    [
      'other subscription payment',
      (f: Fixture) => {
        f.payment.subscriptionId = 'other';
      },
    ],
    [
      'unrefunded payment',
      (f: Fixture) => {
        f.payment.status = PaymentStatus.Paid;
      },
    ],
    [
      'proration restoration',
      (f: Fixture) => {
        f.payment.metadata.operation = 'plan_change_proration';
      },
    ],
    [
      'addon refund',
      (f: Fixture) => {
        f.payment.metadata.subscriptionAddonId = 'addon';
      },
    ],
    [
      'unbound period',
      (f: Fixture) => {
        f.marker.periodEnd = '2026-11-01T12:00:00Z';
      },
    ],
    [
      'older paid period',
      (f: Fixture) => {
        f.subscription.currentPeriodEnd = new Date('2027-01-01T12:00:00Z');
      },
    ],
    [
      'refund after paid period',
      (f: Fixture) => {
        f.refund.refundedAt = new Date('2026-12-02T12:00:00Z');
        f.license.validUntil = f.refund.refundedAt.toISOString();
      },
    ],
    [
      'partial refund',
      (f: Fixture) => {
        f.refund.amount = '100.00';
        f.resource.amount = { total: '100.00', currency: 'MXN' };
      },
    ],
    [
      'excess refunds',
      (f: Fixture) => {
        f.refund.amount = '500.00';
      },
    ],
    [
      'wrong refund currency',
      (f: Fixture) => {
        f.refund.currency = 'USD';
      },
    ],
    [
      'unbound refund',
      (f: Fixture) => {
        f.marker.refundId = 'missing';
      },
    ],
    [
      'wrong payment connection',
      (f: Fixture) => {
        f.payment.metadata.providerConnectionId =
          '88888888-8888-4888-8888-888888888888';
      },
    ],
    [
      'wrong event connection',
      (f: Fixture) => {
        f.event.providerConnectionId = '88888888-8888-4888-8888-888888888888';
      },
    ],
    [
      'unverified webhook',
      (f: Fixture) => {
        f.event.verificationStatus = WebhookVerificationStatus.Failed;
      },
    ],
    [
      'unprocessed webhook',
      (f: Fixture) => {
        f.event.processingStatus = WebhookProcessingStatus.Pending;
      },
    ],
    [
      'manual review webhook',
      (f: Fixture) => {
        f.event.requiresManualReview = true;
      },
    ],
    [
      'reversal webhook',
      (f: Fixture) => {
        f.event.eventType = 'PAYMENT.CAPTURE.REVERSED';
      },
    ],
    [
      'wrong resource',
      (f: Fixture) => {
        f.resource.id = 'other';
      },
    ],
    [
      'wrong sale',
      (f: Fixture) => {
        f.resource.sale_id = 'other';
      },
    ],
    [
      'pending provider refund',
      (f: Fixture) => {
        f.resource.state = 'pending';
      },
    ],
    [
      'wrong provider amount',
      (f: Fixture) => {
        f.resource.amount = { total: '1.00', currency: 'MXN' };
      },
    ],
    [
      'wrong provider time',
      (f: Fixture) => {
        f.resource.create_time = '2026-11-12T16:00:01Z';
      },
    ],
  ] as const)('omits confirmation for %s', async (_name, mutate) => {
    const f = fixture();
    mutate(f);
    expect(await f.confirm()).toBeUndefined();
  });

  it('confirms capture refunds using the capture reference and amount vocabulary', async () => {
    const f = fixture();
    f.event.eventType = 'PAYMENT.CAPTURE.REFUNDED';
    f.resource.status = 'COMPLETED';
    f.resource.supplementary_data = {
      related_ids: { capture_id: f.payment.providerCaptureId },
    };
    f.resource.amount = { value: '499.00', currency_code: 'MXN' };
    expect(await f.confirm()).toMatchObject({ status: 'completed' });
    f.resource.supplementary_data = { related_ids: { capture_id: 'other' } };
    expect(await f.confirm()).toBeUndefined();
  });
});
