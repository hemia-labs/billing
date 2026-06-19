import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingInterval } from 'src/modules/billing-shared';
import {
  AddonStatus,
  BillingAddonType,
  SubscriptionAddonStatus,
  SubscriptionStatus,
} from 'src/modules/billing-shared';
import { BillingSubscriptionAddonsService } from 'src/modules/subscription-addons/billing-subscription-addons.service';

const createRepositoryMock = () => ({
  create: jest.fn((entity) => entity),
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(async (entity) => ({ id: entity.id ?? 'saved-id', ...entity })),
});

const plan = {
  id: 'plan-id',
  code: 'medsync_pro_monthly',
  amount: '999.00',
  currency: 'MXN',
  billingInterval: BillingInterval.Monthly,
  seatsIncluded: 5,
};

const subscription = {
  id: 'subscription-id',
  organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
  productCode: 'medsync',
  planCode: 'medsync_pro_monthly',
  status: SubscriptionStatus.Active,
  nextBillingTime: new Date('2026-07-19T00:00:00Z'),
  currentPeriodEnd: new Date('2026-07-19T00:00:00Z'),
  plan,
};

const addon = {
  id: 'addon-id',
  productCode: 'medsync',
  code: 'extra_user',
  unitPrice: '99.00',
  currency: 'MXN',
  billingInterval: BillingInterval.Monthly,
  type: BillingAddonType.Recurring,
  status: AddonStatus.Active,
};

const activeSubscriptionAddon = {
  id: 'subscription-addon-id',
  subscriptionId: subscription.id,
  subscription,
  addonId: addon.id,
  addon,
  addonCode: addon.code,
  quantity: 3,
  status: SubscriptionAddonStatus.Active,
  unitPrice: addon.unitPrice,
  currency: addon.currency,
  billingInterval: addon.billingInterval,
  pendingEffectiveAt: null,
  currentPeriodEnd: subscription.currentPeriodEnd,
  metadata: {},
  createdAt: new Date('2026-06-19T00:00:00Z'),
  updatedAt: new Date('2026-06-19T00:00:00Z'),
};

describe('BillingSubscriptionAddonsService', () => {
  let subscriptionAddons: ReturnType<typeof createRepositoryMock>;
  let subscriptions: ReturnType<typeof createRepositoryMock>;
  let addons: ReturnType<typeof createRepositoryMock>;
  let usageCounters: ReturnType<typeof createRepositoryMock>;
  let audit: { record: jest.Mock };
  let entitlements: { recalculate: jest.Mock };
  let service: BillingSubscriptionAddonsService;

  beforeEach(() => {
    subscriptionAddons = createRepositoryMock();
    subscriptions = createRepositoryMock();
    addons = createRepositoryMock();
    usageCounters = createRepositoryMock();
    audit = { record: jest.fn().mockResolvedValue({}) };
    entitlements = { recalculate: jest.fn().mockResolvedValue({}) };
    service = new BillingSubscriptionAddonsService(
      subscriptionAddons as never,
      subscriptions as never,
      addons as never,
      usageCounters as never,
      audit as never,
      entitlements as never,
    );
    subscriptions.findOne.mockResolvedValue(subscription);
    addons.findOne.mockResolvedValue(addon);
  });

  it('creates pending add-on for eligible active subscription', async () => {
    subscriptionAddons.findOne.mockResolvedValue(null);

    const result = await service.createPendingAddon(subscription.id, {
      addonCode: 'extra_user',
      quantity: 3,
      idempotencyKey: 'idem-1',
    });

    expect(addons.findOne).toHaveBeenCalledWith({
      where: {
        productCode: 'medsync',
        code: 'extra_user',
        status: AddonStatus.Active,
      },
    });
    expect(subscriptionAddons.save).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: subscription.id,
        addonId: addon.id,
        addonCode: addon.code,
        quantity: 3,
        status: SubscriptionAddonStatus.PendingPayment,
        unitPrice: '99.00',
        currency: 'MXN',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription_addon.pending_created',
        metadata: expect.objectContaining({
          addonCode: 'extra_user',
          quantity: 3,
        }),
      }),
    );
    expect(result.status).toBe(SubscriptionAddonStatus.PendingPayment);
  });

  it('rejects missing subscription', async () => {
    subscriptions.findOne.mockResolvedValue(null);

    await expect(
      service.createPendingAddon(subscription.id, {
        addonCode: 'extra_user',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects invalid subscription status', async () => {
    subscriptions.findOne.mockResolvedValue({
      ...subscription,
      status: SubscriptionStatus.Cancelled,
    });

    await expect(
      service.createPendingAddon(subscription.id, {
        addonCode: 'extra_user',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects addon mismatch or inactive addon', async () => {
    addons.findOne.mockResolvedValue(null);

    await expect(
      service.createPendingAddon(subscription.id, {
        addonCode: 'extra_user',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects addon with different currency', async () => {
    addons.findOne.mockResolvedValue({ ...addon, currency: 'USD' });

    await expect(
      service.createPendingAddon(subscription.id, {
        addonCode: 'extra_user',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects addon with different billing interval', async () => {
    addons.findOne.mockResolvedValue({
      ...addon,
      billingInterval: BillingInterval.Yearly,
    });

    await expect(
      service.createPendingAddon(subscription.id, {
        addonCode: 'extra_user',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('activates pending add-on and recalculates max_users entitlement', async () => {
    subscriptionAddons.findOne.mockResolvedValue({
      ...activeSubscriptionAddon,
      status: SubscriptionAddonStatus.PendingPayment,
    });
    subscriptionAddons.find.mockResolvedValue([activeSubscriptionAddon]);

    await service.activateAddon('subscription-addon-id');

    expect(subscriptionAddons.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: SubscriptionAddonStatus.Active }),
    );
    expect(entitlements.recalculate).toHaveBeenCalledWith(subscription.id);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.subscription_addon.activated' }),
    );
  });

  it('calculates base, add-ons and total monthly amounts', async () => {
    subscriptionAddons.find.mockResolvedValue([activeSubscriptionAddon]);

    const result = await service.getSummary(subscription.id);

    expect(result).toEqual(
      expect.objectContaining({
        subscriptionId: subscription.id,
        planCode: subscription.planCode,
        baseAmount: '999.00',
        addonsAmount: '297.00',
        totalAmount: '1296.00',
        currency: 'MXN',
      }),
    );
  });

  it('schedules cancellation without proration when usage fits new limit', async () => {
    subscriptionAddons.findOne.mockResolvedValue(activeSubscriptionAddon);
    subscriptionAddons.find.mockResolvedValue([activeSubscriptionAddon]);
    usageCounters.findOne.mockResolvedValue({ currentValue: 5 });

    await service.scheduleCancel('subscription-addon-id');

    expect(subscriptionAddons.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SubscriptionAddonStatus.ScheduledCancel,
        pendingEffectiveAt: subscription.nextBillingTime,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription_addon.cancel_scheduled',
      }),
    );
  });

  it('blocks cancellation when usage exceeds new limit', async () => {
    subscriptionAddons.findOne.mockResolvedValue(activeSubscriptionAddon);
    subscriptionAddons.find.mockResolvedValue([activeSubscriptionAddon]);
    usageCounters.findOne.mockResolvedValue({ currentValue: 6 });

    const result = await service.scheduleCancel('subscription-addon-id');

    expect(subscriptionAddons.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SubscriptionAddonStatus.Blocked,
        metadata: expect.objectContaining({
          blockReason: 'usage_exceeds_new_limit',
        }),
      }),
    );
    expect(result.status).toBe(SubscriptionAddonStatus.Blocked);
  });
});
