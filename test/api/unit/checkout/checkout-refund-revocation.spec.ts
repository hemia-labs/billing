import {
  BillingCheckoutSessionEntity,
  BillingLicenseEntity,
  BillingProductEntity,
  BillingProvider,
  BillingSubscriptionEntity,
  LicenseStatus,
  PlanVersionStatus,
  SubscriptionStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import { BillingLicenseCalculatorService } from '../../../../apps/api/src/modules/licenses';
import { BillingPlanCatalogResolver } from '../../../../apps/api/src/modules/catalog';
import { BillingSubscriptionsManagementService } from '../../../../apps/api/src/modules/subscriptions-management/billing-subscriptions-management.service';

function fixture() {
  const periodStart = new Date('2030-01-01T00:00:00Z');
  const periodEnd = new Date('2030-02-01T00:00:00Z');
  const revokedAt = new Date('2030-01-15T00:00:00Z');
  const marker = { refundId: 'R-1', periodStart, periodEnd };
  let stored = {
    id: 'subscription',
    provider: BillingProvider.Paypal,
    providerSubscriptionId: 'I-1',
    organizationId: 'org',
    productCode: 'product',
    planCode: 'basic',
    status: SubscriptionStatus.Cancelled,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    nextBillingTime: null,
    graceUntil: null,
    cancelAtPeriodEnd: false,
    metadata: { refundRevocation: marker, retained: 'value' },
  } as unknown as BillingSubscriptionEntity;
  const license = {
    id: 'license',
    status: LicenseStatus.Revoked,
    validUntil: revokedAt,
  } as BillingLicenseEntity;
  const checkout = {
    id: 'checkout',
    userId: 'user',
    provider: BillingProvider.Paypal,
    status: 'approved',
    metadata: { subscriptionId: stored.id },
  };
  const subscriptions = {
    findOne: jest.fn(() => Promise.resolve(structuredClone(stored))),
    save: jest.fn((value: BillingSubscriptionEntity) => {
      stored = structuredClone(value);
      return Promise.resolve(value);
    }),
  };
  const licenses = {
    findOne: jest.fn(() => Promise.resolve(license)),
    save: jest.fn((value: BillingLicenseEntity) =>
      Promise.resolve(Object.assign(license, value)),
    ),
  };
  const audit = { record: jest.fn() };
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === BillingSubscriptionEntity) return subscriptions;
      if (entity === BillingLicenseEntity) return licenses;
      if (entity === BillingProductEntity)
        return { findOne: () => Promise.resolve({ id: 'product' }) };
      if (entity === BillingCheckoutSessionEntity) return { update: jest.fn() };
      throw new Error('Unexpected repository');
    },
  };
  const paypal = {
    getSubscription: jest.fn(() =>
      Promise.resolve({
        id: 'I-1',
        status: 'ACTIVE',
        billingInfo: {
          next_billing_time: periodEnd.toISOString(),
          cycle_executions: [
            {
              start_time: periodStart.toISOString(),
              end_time: periodEnd.toISOString(),
            },
          ],
        },
      }),
    ),
  };
  const service = new BillingSubscriptionsManagementService(
    {
      transaction: (callback: (value: typeof manager) => unknown) =>
        Promise.resolve(callback(manager)),
    } as never,
    {} as never,
    {} as never,
    paypal as never,
    new BillingLicenseCalculatorService(new BillingPlanCatalogResolver()),
    audit as never,
    {} as never,
    subscriptions as never,
    {} as never,
    { findOne: () => Promise.resolve(checkout) } as never,
  );
  return {
    service,
    paypal,
    subscriptions,
    license,
    marker,
    periodStart,
    periodEnd,
    revokedAt,
    audit,
    stored: () => stored,
    setStored: (value: BillingSubscriptionEntity) => {
      stored = value;
    },
  };
}

describe('manual checkout verification after a refund', () => {
  it.each([false, true])(
    'preserves revocation when PayPal is ACTIVE (later period: %s)',
    async (laterPeriod) => {
      const f = fixture();
      if (laterPeriod) {
        f.paypal.getSubscription.mockResolvedValueOnce({
          id: 'I-1',
          status: 'ACTIVE',
          billingInfo: {
            next_billing_time: '2030-03-01T00:00:00Z',
            cycle_executions: [
              {
                start_time: '2030-02-01T00:00:00Z',
                end_time: '2030-03-01T00:00:00Z',
              },
            ],
          },
        });
      }
      const result = await f.service.verifyCheckoutSession('checkout');
      expect(result).toMatchObject({
        providerStatus: 'ACTIVE',
        subscriptionStatus: SubscriptionStatus.Cancelled,
        licenseStatus: LicenseStatus.Revoked,
      });
      expect(f.stored()).toMatchObject({
        status: SubscriptionStatus.Cancelled,
        currentPeriodStart: f.periodStart,
        currentPeriodEnd: f.periodEnd,
        nextBillingTime: null,
        graceUntil: null,
        metadata: { refundRevocation: f.marker, retained: 'value' },
      });
      expect(f.license).toMatchObject({
        status: LicenseStatus.Revoked,
        validUntil: f.revokedAt,
      });
      expect(f.subscriptions.findOne).toHaveBeenCalledWith({
        where: { id: 'subscription' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(f.audit.record).not.toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ newStatus: 'active' }) as unknown,
        }),
      );
    },
  );

  it('does not grant scheduled cancellation rights to a refunded subscription', async () => {
    const f = fixture();
    f.stored().cancelAtPeriodEnd = true;
    await f.service.verifyCheckoutSession('checkout');
    expect(f.stored().cancelAtPeriodEnd).toBe(false);
    expect(f.license).toMatchObject({
      status: LicenseStatus.Revoked,
      validUntil: f.revokedAt,
    });
  });

  it('activates an ordinary subscription without a refund marker', async () => {
    const f = fixture();
    f.stored().metadata = {};
    f.stored().status = SubscriptionStatus.Pending;
    const result = await f.service.verifyCheckoutSession('checkout');
    expect(result).toMatchObject({
      subscriptionStatus: SubscriptionStatus.Active,
      licenseStatus: LicenseStatus.Active,
    });
    expect(f.license).toMatchObject({
      status: LicenseStatus.Active,
      validUntil: f.periodEnd,
    });
  });

  it('preserves loaded catalog relations when TypeORM returns an entity without relations under lock', async () => {
    const f = fixture();
    f.stored().metadata = {};
    f.stored().status = SubscriptionStatus.Pending;
    const plan = {
      versions: [
        {
          id: 'version',
          version: 1,
          status: PlanVersionStatus.Published,
          entitlements: [
            { feature: { code: 'users.included' }, valueJson: { value: 7 } },
          ],
        },
      ],
    };
    const loaded = Object.assign(new BillingSubscriptionEntity(), f.stored(), {
      plan,
    });
    const locked = Object.assign(new BillingSubscriptionEntity(), f.stored());
    f.subscriptions.findOne
      .mockResolvedValueOnce(loaded)
      .mockResolvedValueOnce(locked);
    await f.service.verifyCheckoutSession('checkout');
    expect(f.license).toMatchObject({
      status: LicenseStatus.Active,
      seatsLimit: 7,
      featuresJson: { 'users.included': 7 },
      validUntil: f.periodEnd,
    });
    expect(f.stored().plan).toEqual(plan);
  });

  it('reloads a refund committed while waiting for PayPal instead of overwriting it', async () => {
    const f = fixture();
    const refunded = structuredClone(f.stored());
    f.stored().metadata = {};
    f.stored().status = SubscriptionStatus.Active;
    const response = await f.paypal.getSubscription();
    f.paypal.getSubscription.mockImplementationOnce(() => {
      f.setStored(refunded);
      return Promise.resolve(response);
    });
    await f.service.verifyCheckoutSession('checkout');
    expect(f.stored().metadata.refundRevocation).toEqual(f.marker);
    expect(f.stored().status).toBe(SubscriptionStatus.Cancelled);
    expect(f.license).toMatchObject({
      status: LicenseStatus.Revoked,
      validUntil: f.revokedAt,
    });
  });
});
