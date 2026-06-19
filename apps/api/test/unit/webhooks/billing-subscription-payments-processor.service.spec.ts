import { EntityManager } from 'typeorm';
import { BillingAuditService } from 'src/modules/audit';
import {
  BillingAuditLogEntity,
  BillingLicenseEntity,
  BillingPaymentEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from 'src/modules/billing-shared';
import {
  BillingProvider,
  LicenseStatus,
  PaymentStatus,
  SubscriptionStatus,
  WebhookProcessingStatus,
} from 'src/modules/billing-shared';
import { BillingLicenseCalculatorService } from 'src/modules/licenses';
import { PaypalClientService } from 'src/modules/paypal';
import { BillingSubscriptionPaymentsProcessorService } from 'src/modules/webhooks/billing-subscription-payments-processor.service';

const createRepositoryMock = () => ({
  create: jest.fn((entity) => entity),
  findOne: jest.fn(),
  save: jest.fn(async (entity) => ({ id: entity.id ?? 'saved-id', ...entity })),
});

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'subscription-id',
  organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
  productCode: 'medsync',
  planCode: 'medsync_pro_monthly',
  provider: BillingProvider.Paypal,
  providerSubscriptionId: 'I-123',
  status: SubscriptionStatus.Pending,
  graceUntil: null,
  metadata: {},
    plan: {
      seatsIncluded: 5,
      featuresJson: { users: 5 },
    },
    legalAcceptanceId: 'acc_123',
    termsVersion: '1.0.0',
    privacyVersion: '1.0.0',
    refundPolicyVersion: '1.0.0',
    acceptedAt: new Date('2026-06-18T00:00:00Z'),
    legalSnapshotHash: 'hash_123',
    ...overrides,
  });

describe('BillingSubscriptionPaymentsProcessorService', () => {
  let paypal: { getSubscription: jest.Mock };
  let licenseCalculator: BillingLicenseCalculatorService;
  let repos: Map<unknown, ReturnType<typeof createRepositoryMock>>;
  let manager: EntityManager;
  let audit: BillingAuditService;
  let service: BillingSubscriptionPaymentsProcessorService;

  beforeEach(() => {
    paypal = {
      getSubscription: jest.fn().mockResolvedValue({
        id: 'I-123',
        status: 'ACTIVE',
        raw: {
          status: 'ACTIVE',
          billing_info: {
            failed_payments_count: 0,
            next_billing_time: '2026-07-18T00:00:00Z',
            last_payment: {
              status: 'COMPLETED',
              amount: { currency_code: 'MXN', value: '499.00' },
              time: '2026-06-18T00:00:00Z',
            },
          },
        },
      }),
    };
    repos = new Map([
      [BillingSubscriptionEntity, createRepositoryMock()],
      [BillingPaymentEntity, createRepositoryMock()],
      [BillingLicenseEntity, createRepositoryMock()],
      [BillingProductEntity, createRepositoryMock()],
      [BillingAuditLogEntity, createRepositoryMock()],
    ]);
    manager = {
      getRepository: (entity: unknown) => {
        const repo = repos.get(entity);
        if (!repo) throw new Error('Unexpected repository');
        return repo;
      },
    } as EntityManager;
    licenseCalculator = new BillingLicenseCalculatorService();
    audit = new BillingAuditService(
      repos.get(BillingAuditLogEntity) as never,
    );
    service = new BillingSubscriptionPaymentsProcessorService(
      paypal as unknown as PaypalClientService,
      licenseCalculator,
      audit,
    );
    repos.get(BillingProductEntity)?.findOne.mockResolvedValue({
      id: 'product-id',
      code: 'medsync',
    });
  });

  it('confirms active subscription server-to-server and creates active license', async () => {
    repos.get(BillingSubscriptionEntity)?.findOne.mockResolvedValue(subscription());
    repos.get(BillingLicenseEntity)?.findOne.mockResolvedValue(null);

    const result = await service.process(manager, {
      eventId: 'event-id',
      providerEventId: 'WH-123',
      eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: 'I-123' },
    });

    expect(result.processingStatus).toBe(WebhookProcessingStatus.Processed);
    expect(paypal.getSubscription).toHaveBeenCalledWith('I-123');
    expect(repos.get(BillingSubscriptionEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SubscriptionStatus.Active,
        nextBillingTime: new Date('2026-07-18T00:00:00Z'),
      }),
    );
    expect(repos.get(BillingLicenseEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'subscription-id',
        status: LicenseStatus.Active,
      }),
    );
    expect(repos.get(BillingAuditLogEntity)?.save).toHaveBeenCalled();
    expect(repos.get(BillingAuditLogEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.status_changed',
        legalAcceptanceId: 'acc_123',
        metadata: expect.objectContaining({
          webhookEventId: 'event-id',
          providerEventId: 'WH-123',
          eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
        }),
      }),
    );
  });

  it('sets past_due and license grace for failed subscription payment', async () => {
    repos.get(BillingSubscriptionEntity)?.findOne.mockResolvedValue(subscription());
    repos.get(BillingLicenseEntity)?.findOne.mockResolvedValue(null);
    paypal.getSubscription.mockResolvedValue({
      id: 'I-123',
      status: 'ACTIVE',
      raw: {
        status: 'ACTIVE',
        billing_info: {
          failed_payments_count: 1,
          last_failed_payment: {
            reason_code: 'PAYMENT_DENIED',
            time: '2026-06-18T00:00:00Z',
          },
        },
      },
    });

    await service.process(manager, {
      eventId: 'event-id',
      providerEventId: 'WH-FAILED',
      eventType: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      resource: { id: 'I-123' },
    });

    expect(repos.get(BillingSubscriptionEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SubscriptionStatus.PastDue,
        graceUntil: expect.any(Date),
      }),
    );
    expect(repos.get(BillingLicenseEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: LicenseStatus.Grace }),
    );
  });

  it.each([
    ['BILLING.SUBSCRIPTION.SUSPENDED', 'SUSPENDED', SubscriptionStatus.Suspended, LicenseStatus.Suspended],
    ['BILLING.SUBSCRIPTION.CANCELLED', 'CANCELLED', SubscriptionStatus.Cancelled, LicenseStatus.Revoked],
    ['BILLING.SUBSCRIPTION.EXPIRED', 'EXPIRED', SubscriptionStatus.Expired, LicenseStatus.Revoked],
  ])(
    'maps %s to subscription and license statuses',
    async (eventType, paypalStatus, subStatus, licenseStatus) => {
      repos.get(BillingSubscriptionEntity)?.findOne.mockResolvedValue(subscription());
      repos.get(BillingLicenseEntity)?.findOne.mockResolvedValue({
        id: 'license-id',
        status: LicenseStatus.Active,
        subscriptionId: 'subscription-id',
      });
      paypal.getSubscription.mockResolvedValue({
        id: 'I-123',
        status: paypalStatus,
        raw: { status: paypalStatus, billing_info: {} },
      });

      await service.process(manager, {
        eventId: 'event-id',
        providerEventId: `WH-${eventType}`,
        eventType,
        resource: { id: 'I-123' },
      });

      expect(repos.get(BillingSubscriptionEntity)?.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: subStatus }),
      );
      expect(repos.get(BillingLicenseEntity)?.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: licenseStatus }),
      );
    },
  );

  it('creates paid payment and reactivates past_due subscription', async () => {
    repos.get(BillingSubscriptionEntity)?.findOne.mockResolvedValue(
      subscription({
        status: SubscriptionStatus.PastDue,
        graceUntil: new Date('2026-06-25T00:00:00Z'),
      }),
    );
    repos.get(BillingPaymentEntity)?.findOne.mockResolvedValue(null);
    repos.get(BillingLicenseEntity)?.findOne.mockResolvedValue({
      id: 'license-id',
      status: LicenseStatus.Grace,
      subscriptionId: 'subscription-id',
    });

    await service.process(manager, {
      eventId: 'event-id',
      providerEventId: 'WH-PAID',
      eventType: 'PAYMENT.SALE.COMPLETED',
      resource: {
        id: 'SALE-123',
        parent_payment: 'PAY-123',
        billing_agreement_id: 'I-123',
        amount: { total: '499.00', currency: 'MXN' },
        create_time: '2026-06-18T00:00:00Z',
      },
    });

    expect(repos.get(BillingPaymentEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCaptureId: 'SALE-123',
        providerPaymentId: 'PAY-123',
        amount: '499.00',
        currency: 'MXN',
        status: PaymentStatus.Paid,
      }),
    );
    expect(repos.get(BillingSubscriptionEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SubscriptionStatus.Active,
        graceUntil: null,
      }),
    );
    expect(repos.get(BillingLicenseEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: LicenseStatus.Active }),
    );
  });

  it('updates payment as refunded', async () => {
    repos.get(BillingPaymentEntity)?.findOne.mockResolvedValue({
      id: 'payment-id',
      organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
      providerCaptureId: 'SALE-123',
      status: PaymentStatus.Paid,
      metadata: {},
    });

    await service.process(manager, {
      eventId: 'event-id',
      providerEventId: 'WH-REFUND',
      eventType: 'PAYMENT.SALE.REFUNDED',
      resource: { id: 'SALE-123' },
    });

    expect(repos.get(BillingPaymentEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.Refunded }),
    );
    expect(repos.get(BillingAuditLogEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.payment.status_changed',
        metadata: expect.not.objectContaining({
          paypalResource: expect.anything(),
        }),
      }),
    );
  });

  it('updates payment reversed and moves subscription to grace', async () => {
    repos.get(BillingPaymentEntity)?.findOne.mockResolvedValue({
      id: 'payment-id',
      organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
      providerCaptureId: 'SALE-123',
      status: PaymentStatus.Paid,
      metadata: {},
    });
    repos.get(BillingSubscriptionEntity)?.findOne.mockResolvedValue(
      subscription({ status: SubscriptionStatus.Active }),
    );
    repos.get(BillingLicenseEntity)?.findOne.mockResolvedValue({
      id: 'license-id',
      status: LicenseStatus.Active,
      subscriptionId: 'subscription-id',
    });

    await service.process(manager, {
      eventId: 'event-id',
      providerEventId: 'WH-REVERSE',
      eventType: 'PAYMENT.SALE.REVERSED',
      resource: { id: 'SALE-123', billing_agreement_id: 'I-123' },
    });

    expect(repos.get(BillingPaymentEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.Reversed }),
    );
    expect(repos.get(BillingSubscriptionEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SubscriptionStatus.PastDue,
        graceUntil: expect.any(Date),
      }),
    );
    expect(repos.get(BillingLicenseEntity)?.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: LicenseStatus.Grace }),
    );
  });

  it('ignores payment when subscription cannot be resolved', async () => {
    repos.get(BillingSubscriptionEntity)?.findOne.mockResolvedValue(null);

    const result = await service.process(manager, {
      eventId: 'event-id',
      providerEventId: 'WH-ORPHAN',
      eventType: 'PAYMENT.SALE.COMPLETED',
      resource: { id: 'SALE-123' },
    });

    expect(result).toEqual({
      processingStatus: WebhookProcessingStatus.Ignored,
      note: 'Payment subscription not found',
    });
    expect(repos.get(BillingPaymentEntity)?.save).not.toHaveBeenCalled();
  });
});
