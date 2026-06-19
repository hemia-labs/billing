import { BillingInterval } from 'src/modules/billing-shared';
import {
  EntitlementStatus,
  SubscriptionAddonStatus,
  SubscriptionStatus,
} from 'src/modules/billing-shared';
import { BillingEntitlementsService } from 'src/modules/entitlements/billing-entitlements.service';

const createRepositoryMock = () => ({
  create: jest.fn((entity) => entity),
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(async (entity) => ({ id: entity.id ?? 'saved-id', ...entity })),
});

const subscription = {
  id: 'subscription-id',
  organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
  productCode: 'medsync',
  planCode: 'medsync_pro_monthly',
  status: SubscriptionStatus.Active,
  plan: {
    amount: '999.00',
    currency: 'MXN',
    billingInterval: BillingInterval.Monthly,
    seatsIncluded: 5,
    featuresJson: {
      max_agents: 3,
      max_conversations_monthly: 5000,
    },
  },
};

const activeExtraUserAddon = {
  id: 'subscription-addon-id',
  subscriptionId: subscription.id,
  addonCode: 'extra_user',
  quantity: 3,
  status: SubscriptionAddonStatus.Active,
  unitPrice: '99.00',
  currency: 'MXN',
  billingInterval: BillingInterval.Monthly,
};

describe('BillingEntitlementsService', () => {
  let subscriptions: ReturnType<typeof createRepositoryMock>;
  let subscriptionAddons: ReturnType<typeof createRepositoryMock>;
  let entitlements: ReturnType<typeof createRepositoryMock>;
  let audit: { record: jest.Mock };
  let service: BillingEntitlementsService;

  beforeEach(() => {
    subscriptions = createRepositoryMock();
    subscriptionAddons = createRepositoryMock();
    entitlements = createRepositoryMock();
    audit = { record: jest.fn().mockResolvedValue({}) };
    service = new BillingEntitlementsService(
      subscriptions as never,
      subscriptionAddons as never,
      entitlements as never,
      audit as never,
    );
    subscriptions.findOne.mockResolvedValue(subscription);
    entitlements.findOne.mockResolvedValue(null);
  });

  it('calculates users, feature limits, billing and persists entitlements', async () => {
    subscriptionAddons.find.mockResolvedValue([activeExtraUserAddon]);

    const result = await service.recalculate(subscription.id);

    expect(result).toEqual({
      entitlements: {
        maxUsers: 8,
        includedUsers: 5,
        extraUsers: 3,
        maxAgents: 3,
        maxConversationsMonthly: 5000,
      },
      billing: {
        baseMonthly: '999.00',
        addonsMonthly: '297.00',
        totalMonthly: '1296.00',
        currency: 'MXN',
      },
    });
    expect(entitlements.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'max_users',
        value: 8,
        status: EntitlementStatus.Active,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.entitlements.recalculated' }),
    );
  });

  it('ignores non-active add-ons', async () => {
    subscriptionAddons.find.mockResolvedValue([
      { ...activeExtraUserAddon, status: SubscriptionAddonStatus.PendingPayment },
    ]);

    const result = await service.recalculate(subscription.id);

    expect(result.entitlements).toEqual(
      expect.objectContaining({
        maxUsers: 5,
        includedUsers: 5,
        extraUsers: 0,
      }),
    );
  });

  it('uses safe fallback for absent feature keys', async () => {
    subscriptions.findOne.mockResolvedValue({
      ...subscription,
      plan: { ...subscription.plan, featuresJson: {} },
    });
    subscriptionAddons.find.mockResolvedValue([]);

    const result = await service.recalculate(subscription.id);

    expect(result.entitlements.maxAgents).toBe(0);
    expect(result.entitlements.maxConversationsMonthly).toBeNull();
  });

  it('uses persisted active entitlements when complete', async () => {
    entitlements.find.mockResolvedValue([
      { key: 'max_users', value: 8, metadata: {} },
      { key: 'included_users', value: 5, metadata: {} },
      { key: 'extra_users', value: 3, metadata: {} },
      { key: 'max_agents', value: 3, metadata: {} },
      { key: 'max_conversations_monthly', value: 5000, metadata: {} },
    ]);
    subscriptionAddons.find.mockResolvedValue([activeExtraUserAddon]);

    const result = await service.resolveForSubscription(subscription.id);

    expect(result.entitlements.maxUsers).toBe(8);
    expect(entitlements.save).not.toHaveBeenCalled();
  });

  it('recalculates when persisted entitlements are incomplete', async () => {
    entitlements.find.mockResolvedValue([{ key: 'max_users', value: 8 }]);
    subscriptionAddons.find.mockResolvedValue([activeExtraUserAddon]);

    await service.resolveForSubscription(subscription.id);

    expect(entitlements.save).toHaveBeenCalled();
  });

  it('marks active entitlements as stale', async () => {
    entitlements.find.mockResolvedValue([
      { id: 'entitlement-id', status: EntitlementStatus.Active },
    ]);

    await service.markStale(subscription.id);

    expect(entitlements.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: EntitlementStatus.Stale }),
    );
  });
});
