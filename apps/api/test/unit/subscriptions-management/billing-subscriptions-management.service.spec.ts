import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingInterval } from 'src/modules/billing-shared';
import {
  BillingCheckoutSessionEntity,
  BillingLicenseEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from 'src/modules/billing-shared';
import {
  BillingCheckoutSessionStatus,
  BillingPlanStatus,
  BillingProvider,
  LicenseStatus,
  SubscriptionStatus,
} from 'src/modules/billing-shared';
import { BillingSubscriptionsManagementService } from 'src/modules/subscriptions-management/billing-subscriptions-management.service';

const createRepositoryMock = () => ({
  create: jest.fn((entity) => entity),
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(async (entity) => ({ ...entity, id: entity.id ?? 'saved-id' })),
});

const plan = {
  id: 'plan-id',
  productId: 'product-id',
  code: 'medsync_basic_monthly',
  provider: BillingProvider.Paypal,
  providerPlanId: 'P-BASIC',
  amount: '499.00',
  currency: 'MXN',
  billingInterval: BillingInterval.Monthly,
  seatsIncluded: 3,
  featuresJson: {},
  status: BillingPlanStatus.Active,
};

const targetPlan = {
  ...plan,
  id: 'target-plan-id',
  code: 'medsync_plus_monthly',
  providerPlanId: 'P-PLUS',
  amount: '999.00',
};

const subscription = {
  id: 'subscription-id',
  organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
  billingCustomerId: 'customer-id',
  planId: plan.id,
  plan,
  productCode: 'medsync',
  planCode: plan.code,
  provider: BillingProvider.Paypal,
  providerSubscriptionId: 'I-123',
  status: SubscriptionStatus.Active,
  currentPeriodStart: null,
  currentPeriodEnd: new Date('2026-07-19T00:00:00Z'),
  nextBillingTime: new Date('2026-07-19T00:00:00Z'),
  cancelAtPeriodEnd: false,
  graceUntil: null,
  legalAcceptanceId: 'legal-1',
  termsVersion: 'terms-v1',
  privacyVersion: 'privacy-v1',
  refundPolicyVersion: 'refund-v1',
  acceptedAt: new Date('2026-06-19T00:00:00Z'),
  legalSnapshotHash: 'hash-1',
  metadata: {},
  createdAt: new Date('2026-06-19T00:00:00Z'),
  updatedAt: new Date('2026-06-19T00:00:00Z'),
} as never as BillingSubscriptionEntity;

const entitlementResolution = {
  entitlements: {
    maxUsers: 3,
    includedUsers: 3,
    extraUsers: 0,
    maxAgents: 0,
    maxConversationsMonthly: null,
  },
  billing: {
    baseMonthly: '499.00',
    addonsMonthly: '0.00',
    totalMonthly: '499.00',
    currency: 'MXN',
  },
};

describe('BillingSubscriptionsManagementService', () => {
  let dataSource: { transaction: jest.Mock };
  let manager: { getRepository: jest.Mock };
  let subscriptions: ReturnType<typeof createRepositoryMock>;
  let plans: ReturnType<typeof createRepositoryMock>;
  let checkoutSessions: ReturnType<typeof createRepositoryMock>;
  let managerSubscriptions: ReturnType<typeof createRepositoryMock>;
  let managerCheckoutSessions: ReturnType<typeof createRepositoryMock>;
  let managerLicenses: ReturnType<typeof createRepositoryMock>;
  let managerProducts: ReturnType<typeof createRepositoryMock>;
  let checkout: { createCheckoutSession: jest.Mock };
  let entitlements: { resolveForSubscription: jest.Mock };
  let paypal: { cancelSubscription: jest.Mock; getSubscription: jest.Mock };
  let licenseCalculator: { calculate: jest.Mock };
  let audit: { record: jest.Mock };
  let service: BillingSubscriptionsManagementService;

  beforeEach(() => {
    subscriptions = createRepositoryMock();
    plans = createRepositoryMock();
    checkoutSessions = createRepositoryMock();
    managerSubscriptions = createRepositoryMock();
    managerCheckoutSessions = createRepositoryMock();
    managerLicenses = createRepositoryMock();
    managerProducts = createRepositoryMock();
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === BillingSubscriptionEntity) return managerSubscriptions;
        if (entity === BillingCheckoutSessionEntity) return managerCheckoutSessions;
        if (entity === BillingLicenseEntity) return managerLicenses;
        if (entity === BillingProductEntity) return managerProducts;
        return createRepositoryMock();
      }),
    };
    dataSource = { transaction: jest.fn((callback) => callback(manager)) };
    checkout = {
      createCheckoutSession: jest.fn().mockResolvedValue({
        checkoutId: 'new-checkout-id',
        subscriptionId: 'new-subscription-id',
        checkoutUrl: 'https://paypal.test/approve',
        status: BillingCheckoutSessionStatus.Created,
      }),
    };
    entitlements = {
      resolveForSubscription: jest.fn().mockResolvedValue(entitlementResolution),
    };
    paypal = {
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
      getSubscription: jest.fn(),
    };
    licenseCalculator = {
      calculate: jest.fn().mockReturnValue({
        organizationId: subscription.organizationId,
        productId: 'product-id',
        productCode: subscription.productCode,
        subscriptionId: subscription.id,
        planCode: subscription.planCode,
        licenseKeyHash: null,
        status: LicenseStatus.Active,
        seatsLimit: 3,
        usageLimit: null,
        featuresJson: {},
        validUntil: subscription.nextBillingTime,
      }),
    };
    audit = { record: jest.fn().mockResolvedValue({}) };
    service = new BillingSubscriptionsManagementService(
      dataSource as never,
      checkout as never,
      entitlements as never,
      paypal as never,
      licenseCalculator as never,
      audit as never,
      subscriptions as never,
      plans as never,
      checkoutSessions as never,
    );

    subscriptions.findOne.mockResolvedValue({ ...subscription });
    subscriptions.find.mockResolvedValue([{ ...subscription }]);
    plans.findOne.mockResolvedValue(targetPlan);
  });

  it('returns current subscription by status priority with entitlements', async () => {
    subscriptions.find.mockResolvedValue([
      {
        ...subscription,
        id: 'pending-id',
        status: SubscriptionStatus.Pending,
        updatedAt: new Date('2026-06-20T00:00:00Z'),
      },
      {
        ...subscription,
        id: 'active-id',
        status: SubscriptionStatus.Active,
        updatedAt: new Date('2026-06-19T00:00:00Z'),
      },
    ]);

    const result = await service.getCurrentSubscription(
      subscription.organizationId,
      subscription.productCode,
    );

    expect(result.id).toBe('active-id');
    expect(result.entitlements.maxUsers).toBe(3);
    expect(subscriptions.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: subscription.organizationId,
          productCode: subscription.productCode,
        }),
      }),
    );
  });

  it('rejects when current subscription does not exist', async () => {
    subscriptions.find.mockResolvedValue([]);

    await expect(
      service.getCurrentSubscription(subscription.organizationId, 'medsync'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancels provider renewal, marks cancelAtPeriodEnd and audits', async () => {
    const result = await service.cancelSubscription(subscription.id, {
      reason: 'No longer needed',
    });

    expect(paypal.cancelSubscription).toHaveBeenCalledWith({
      providerSubscriptionId: 'I-123',
      reason: 'No longer needed',
    });
    expect(managerSubscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({ cancelAtPeriodEnd: true }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.cancel_scheduled',
        metadata: expect.objectContaining({
          subscriptionId: subscription.id,
          providerSubscriptionId: 'I-123',
        }),
      }),
    );
    expect(result.cancelAtPeriodEnd).toBe(true);
  });

  it('rejects terminal subscription cancellation', async () => {
    subscriptions.findOne.mockResolvedValue({
      ...subscription,
      status: SubscriptionStatus.Cancelled,
    });

    await expect(
      service.cancelSubscription(subscription.id, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates checkout for change plan and records pending change', async () => {
    const result = await service.changePlan(subscription.id, {
      targetPlanCode: targetPlan.code,
      legalAcceptanceId: 'legal-2',
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
      billingEmail: 'billing@example.com',
    });

    expect(checkout.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: subscription.organizationId,
        productCode: 'medsync',
        planCode: targetPlan.code,
        legalAcceptanceId: 'legal-2',
      }),
    );
    expect(paypal.cancelSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ providerSubscriptionId: 'I-123' }),
    );
    expect(managerSubscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelAtPeriodEnd: true,
        metadata: expect.objectContaining({
          pendingPlanChange: expect.objectContaining({
            checkoutSessionId: 'new-checkout-id',
            targetPlanCode: targetPlan.code,
          }),
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.plan_change_requested',
      }),
    );
    expect(result.checkoutId).toBe('new-checkout-id');
  });

  it('rejects target plan with different currency', async () => {
    plans.findOne.mockResolvedValue({ ...targetPlan, currency: 'USD' });

    await expect(
      service.changePlan(subscription.id, {
        targetPlanCode: targetPlan.code,
        legalAcceptanceId: 'legal-2',
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('manually verifies active checkout and avoids raw PayPal payload in audit metadata', async () => {
    checkoutSessions.findOne.mockResolvedValue({
      id: 'checkout-id',
      organizationId: subscription.organizationId,
      userId: 'user-id',
      provider: BillingProvider.Paypal,
      status: BillingCheckoutSessionStatus.Created,
      metadata: { subscriptionId: subscription.id },
    });
    paypal.getSubscription.mockResolvedValue({
      id: 'I-123',
      status: 'ACTIVE',
      planId: 'P-BASIC',
      billingInfo: { next_billing_time: '2026-07-19T00:00:00Z' },
      raw: { id: 'I-123', status: 'ACTIVE', resource: { full: true } },
    });
    managerProducts.findOne.mockResolvedValue({ id: 'product-id', code: 'medsync' });
    managerLicenses.findOne.mockResolvedValue(null);

    const result = await service.verifyCheckoutSession('checkout-id');

    expect(managerSubscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SubscriptionStatus.Active,
        metadata: expect.not.objectContaining({
          raw: expect.anything(),
          paypalResource: expect.anything(),
        }),
      }),
    );
    expect(managerCheckoutSessions.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: BillingCheckoutSessionStatus.Approved }),
    );
    expect(managerLicenses.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: LicenseStatus.Active }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.checkout.manual_verified',
        metadata: expect.not.objectContaining({
          raw: expect.anything(),
          paypalResource: expect.anything(),
        }),
      }),
    );
    expect(result.providerStatus).toBe('ACTIVE');
  });

  it('maps cancelled manual verification to revoked license', async () => {
    checkoutSessions.findOne.mockResolvedValue({
      id: 'checkout-id',
      organizationId: subscription.organizationId,
      userId: 'user-id',
      provider: BillingProvider.Paypal,
      status: BillingCheckoutSessionStatus.Created,
      metadata: { subscriptionId: subscription.id },
    });
    paypal.getSubscription.mockResolvedValue({
      id: 'I-123',
      status: 'CANCELLED',
      planId: 'P-BASIC',
      billingInfo: {},
      raw: {},
    });
    managerProducts.findOne.mockResolvedValue({ id: 'product-id', code: 'medsync' });
    licenseCalculator.calculate.mockReturnValueOnce({
      organizationId: subscription.organizationId,
      productId: 'product-id',
      productCode: subscription.productCode,
      subscriptionId: subscription.id,
      planCode: subscription.planCode,
      licenseKeyHash: null,
      status: LicenseStatus.Revoked,
      seatsLimit: 3,
      usageLimit: null,
      featuresJson: {},
      validUntil: null,
    });

    const result = await service.verifyCheckoutSession('checkout-id');

    expect(managerSubscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: SubscriptionStatus.Cancelled }),
    );
    expect(managerLicenses.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: LicenseStatus.Revoked }),
    );
    expect(result.licenseStatus).toBe(LicenseStatus.Revoked);
  });
});
