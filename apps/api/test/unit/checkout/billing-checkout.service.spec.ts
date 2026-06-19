import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BillingAuditLogEntity,
  BillingCheckoutSessionEntity,
  BillingCustomerEntity,
  BillingSubscriptionEntity,
} from 'src/modules/billing-shared';
import {
  BillingCheckoutSessionStatus,
  BillingCustomerStatus,
  BillingPlanStatus,
  BillingProductStatus,
  BillingProvider,
  SubscriptionStatus,
} from 'src/modules/billing-shared';
import { BillingAuditService } from 'src/modules/audit';
import { BillingCheckoutService } from 'src/modules/checkout/billing-checkout.service';

const dto = {
  organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
  userId: 'fcfba5df-5cd6-4e08-967c-fc39f17be1fa',
  productCode: 'medsync',
  planCode: 'medsync_pro_monthly',
  provider: BillingProvider.Paypal,
  legalAcceptanceId: 'acc_123',
  successUrl: 'https://medsync.test/success',
  cancelUrl: 'https://medsync.test/cancel',
  billingEmail: 'billing@example.com',
};

const legalResult = {
  valid: true,
  legalAcceptanceId: 'acc_123',
  termsVersion: '1.0.0',
  privacyVersion: '1.0.0',
  refundPolicyVersion: '1.0.0',
  acceptedAt: '2026-06-18T00:00:00.000Z',
  legalSnapshotHash: 'hash_123',
  raw: {},
};

const product = {
  id: 'product-id',
  code: 'medsync',
  status: BillingProductStatus.Active,
};

const plan = {
  id: 'plan-id',
  code: 'medsync_pro_monthly',
  provider: BillingProvider.Paypal,
  providerPlanId: 'P-123',
  status: BillingPlanStatus.Active,
};

const createRepositoryMock = () => ({
  create: jest.fn((entity) => entity),
  findOne: jest.fn(),
  save: jest.fn(async (entity) => entity),
});

describe('BillingCheckoutService', () => {
  let dataSource: { transaction: jest.Mock };
  let hemiaLegal: { validateAcceptance: jest.Mock };
  let paypal: { createSubscription: jest.Mock };
  let checkoutSessions: ReturnType<typeof createRepositoryMock>;
  let plans: ReturnType<typeof createRepositoryMock>;
  let products: ReturnType<typeof createRepositoryMock>;
  let subscriptions: ReturnType<typeof createRepositoryMock>;
  let customerManagerRepo: ReturnType<typeof createRepositoryMock>;
  let subscriptionManagerRepo: ReturnType<typeof createRepositoryMock>;
  let checkoutManagerRepo: ReturnType<typeof createRepositoryMock>;
  let auditRepo: ReturnType<typeof createRepositoryMock>;
  let audit: BillingAuditService;
  let service: BillingCheckoutService;

  beforeEach(() => {
    customerManagerRepo = createRepositoryMock();
    subscriptionManagerRepo = createRepositoryMock();
    checkoutManagerRepo = createRepositoryMock();
    auditRepo = createRepositoryMock();
    checkoutSessions = createRepositoryMock();
    plans = createRepositoryMock();
    products = createRepositoryMock();
    subscriptions = createRepositoryMock();
    hemiaLegal = { validateAcceptance: jest.fn().mockResolvedValue(legalResult) };
    paypal = {
      createSubscription: jest.fn().mockResolvedValue({
        id: 'I-123',
        approvalUrl: 'https://paypal.test/approve',
      }),
    };
    dataSource = {
      transaction: jest.fn(async (callback) =>
        callback({
          getRepository: (entity: unknown) => {
            if (entity === BillingCustomerEntity) return customerManagerRepo;
            if (entity === BillingSubscriptionEntity) {
              return subscriptionManagerRepo;
            }
            if (entity === BillingCheckoutSessionEntity) {
              return checkoutManagerRepo;
            }
            if (entity === BillingAuditLogEntity) return auditRepo;
            throw new Error('Unexpected repository');
          },
        }),
      ),
    };
    audit = new BillingAuditService(auditRepo as never);
    service = new BillingCheckoutService(
      dataSource as unknown as DataSource,
      hemiaLegal as never,
      paypal as never,
      audit,
      checkoutSessions as never,
      plans as never,
      products as never,
      subscriptions as never,
    );

    products.findOne.mockResolvedValue(product);
    plans.findOne.mockResolvedValue(plan);
    customerManagerRepo.findOne.mockResolvedValue(null);
    customerManagerRepo.save.mockResolvedValue({
      id: 'customer-id',
      status: BillingCustomerStatus.Active,
    });
    subscriptionManagerRepo.save.mockResolvedValue({
      id: 'subscription-id',
      status: SubscriptionStatus.Pending,
      providerSubscriptionId: null,
      organizationId: dto.organizationId,
      legalAcceptanceId: legalResult.legalAcceptanceId,
      termsVersion: legalResult.termsVersion,
      privacyVersion: legalResult.privacyVersion,
      refundPolicyVersion: legalResult.refundPolicyVersion,
      acceptedAt: new Date(legalResult.acceptedAt),
      legalSnapshotHash: legalResult.legalSnapshotHash,
    });
    checkoutManagerRepo.save.mockResolvedValue({
      id: 'checkout-id',
      status: BillingCheckoutSessionStatus.Created,
      organizationId: dto.organizationId,
      userId: dto.userId,
      providerCheckoutUrl: null,
      legalAcceptanceId: legalResult.legalAcceptanceId,
      termsVersion: legalResult.termsVersion,
      privacyVersion: legalResult.privacyVersion,
      refundPolicyVersion: legalResult.refundPolicyVersion,
      acceptedAt: new Date(legalResult.acceptedAt),
      legalSnapshotHash: legalResult.legalSnapshotHash,
      metadata: { subscriptionId: 'subscription-id' },
    });
  });

  it('creates customer, subscription, checkout session and returns checkout URL', async () => {
    const result = await service.createCheckoutSession(dto);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(paypal.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPlanId: 'P-123',
        customId: 'checkout-id',
        returnUrl: dto.successUrl,
        cancelUrl: dto.cancelUrl,
      }),
    );
    expect(subscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({ providerSubscriptionId: 'I-123' }),
    );
    expect(checkoutSessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCheckoutUrl: 'https://paypal.test/approve',
      }),
    );
    expect(result).toEqual({
      checkoutId: 'checkout-id',
      subscriptionId: 'subscription-id',
      checkoutUrl: 'https://paypal.test/approve',
      status: BillingCheckoutSessionStatus.Created,
    });
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.checkout.created',
        legalAcceptanceId: 'acc_123',
        metadata: {
          checkoutSessionId: 'checkout-id',
          subscriptionId: 'subscription-id',
        },
      }),
    );
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.created',
        legalAcceptanceId: 'acc_123',
      }),
    );
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.provider_linked',
        legalAcceptanceId: 'acc_123',
      }),
    );
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.checkout.paypal_created',
        legalAcceptanceId: 'acc_123',
      }),
    );
  });

  it('blocks checkout when Hemia Legal rejects acceptance', async () => {
    hemiaLegal.validateAcceptance.mockRejectedValue(
      new BadRequestException('Legal acceptance is not valid'),
    );

    await expect(service.createCheckoutSession(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('blocks checkout when plan has no PayPal provider plan id', async () => {
    plans.findOne.mockResolvedValue({ ...plan, providerPlanId: null });

    await expect(service.createCheckoutSession(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('marks checkout failed when PayPal fails after DB records exist', async () => {
    paypal.createSubscription.mockRejectedValue(new Error('paypal failed'));

    await expect(service.createCheckoutSession(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(checkoutSessions.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: BillingCheckoutSessionStatus.Failed }),
    );
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.checkout.failed',
        legalAcceptanceId: 'acc_123',
        metadata: {
          checkoutSessionId: 'checkout-id',
          subscriptionId: 'subscription-id',
        },
      }),
    );
  });

  it('returns checkout status', async () => {
    checkoutSessions.findOne.mockResolvedValue({
      id: 'checkout-id',
      status: BillingCheckoutSessionStatus.Created,
      provider: BillingProvider.Paypal,
      providerCheckoutUrl: 'https://paypal.test/approve',
      metadata: { subscriptionId: 'subscription-id' },
    });
    subscriptions.findOne.mockResolvedValue({
      id: 'subscription-id',
      status: SubscriptionStatus.Pending,
    });

    await expect(service.getCheckoutStatus('checkout-id')).resolves.toEqual({
      checkoutId: 'checkout-id',
      subscriptionId: 'subscription-id',
      checkoutStatus: BillingCheckoutSessionStatus.Created,
      subscriptionStatus: SubscriptionStatus.Pending,
      provider: BillingProvider.Paypal,
      providerCheckoutUrl: 'https://paypal.test/approve',
    });
  });

  it('throws not found for missing checkout status', async () => {
    checkoutSessions.findOne.mockResolvedValue(null);

    await expect(service.getCheckoutStatus('checkout-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
