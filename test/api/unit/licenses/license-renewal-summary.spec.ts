import { BillingLicensesService } from '../../../../apps/api/src/modules/licenses/billing-licenses.service';
import type { Repository } from 'typeorm';
import type { BillingEntitlementsService } from '../../../../apps/api/src/modules/entitlements';
import {
  BillingLicenseEntity,
  BillingSubscriptionEntity,
  LicenseStatus,
  SubscriptionStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import { BillingLicenseMapper } from '../../../../apps/api/src/modules/licenses/mappers/billing-license.mapper';

const now = new Date('2030-01-01T00:00:00Z');
const renewal = new Date('2030-02-01T00:00:00Z');
function fixture() {
  return Object.assign(new BillingLicenseEntity(), {
    productCode: 'balanz_cfdi',
    planCode: 'professional',
    subscriptionId: 'subscription',
    status: LicenseStatus.Active,
    validUntil: renewal,
    featuresJson: {},
    seatsLimit: 2,
    subscription: Object.assign(new BillingSubscriptionEntity(), {
      status: SubscriptionStatus.Active,
      nextBillingTime: renewal,
      cancelAtPeriodEnd: false,
    }),
  });
}

describe('license renewal summary', () => {
  it('exposes the provider renewal inside billing without changing the license expiry', () => {
    const result = BillingLicenseMapper.toResolveDto(
      fixture(),
      'balanz_cfdi',
      now,
    );
    expect(result.billing).toMatchObject({
      currency: 'MXN',
      nextBillingTime: renewal.toISOString(),
    });
    expect(result.validUntil).toBe(renewal.toISOString());
    expect(result).not.toHaveProperty('nextBillingTime');
  });

  it('keeps the calculated amounts and uses the loaded subscription renewal', () => {
    const defaultResult = BillingLicenseMapper.toResolveDto(
      fixture(),
      'balanz_cfdi',
      now,
    );
    const result = BillingLicenseMapper.toResolveDto(
      fixture(),
      'balanz_cfdi',
      now,
      {
        entitlements: defaultResult.entitlements,
        billing: {
          baseMonthly: '499.00',
          addonsMonthly: '99.00',
          totalMonthly: '598.00',
          currency: 'MXN',
          nextBillingTime: '1999-01-01T00:00:00Z',
        },
      },
    );
    expect(result.billing).toEqual({
      baseMonthly: '499.00',
      addonsMonthly: '99.00',
      totalMonthly: '598.00',
      currency: 'MXN',
      nextBillingTime: renewal.toISOString(),
    });
  });

  it('does not announce a renewal after cancellation at the end of the paid period', () => {
    const license = fixture();
    license.subscription.cancelAtPeriodEnd = true;
    const result = BillingLicenseMapper.toResolveDto(
      license,
      'balanz_cfdi',
      now,
    );
    expect(result.active).toBe(true);
    expect(result.billing.nextBillingTime).toBeNull();
  });

  it.each([
    SubscriptionStatus.Cancelled,
    SubscriptionStatus.Suspended,
    SubscriptionStatus.Pending,
  ])('does not announce renewal for a %s subscription', (status) => {
    const license = fixture();
    license.subscription.status = status;
    expect(
      BillingLicenseMapper.toResolveDto(license, 'balanz_cfdi', now).billing
        .nextBillingTime,
    ).toBeNull();
  });

  it.each([
    LicenseStatus.Revoked,
    LicenseStatus.Suspended,
    LicenseStatus.Grace,
  ])('does not announce renewal from a %s license', (status) => {
    const license = fixture();
    license.status = status;
    expect(
      BillingLicenseMapper.toResolveDto(license, 'balanz_cfdi', now).billing
        .nextBillingTime,
    ).toBeNull();
  });

  it('does not announce renewal for expired access', () => {
    const license = fixture();
    license.validUntil = new Date(now.getTime() - 1);
    expect(
      BillingLicenseMapper.toResolveDto(license, 'balanz_cfdi', now).billing
        .nextBillingTime,
    ).toBeNull();
  });

  it('preserves absence instead of inferring renewal from expiry', () => {
    const license = fixture();
    license.subscription.nextBillingTime = null;
    expect(
      BillingLicenseMapper.toResolveDto(license, 'balanz_cfdi', now).billing
        .nextBillingTime,
    ).toBeNull();
    license.subscription = null;
    expect(
      BillingLicenseMapper.toResolveDto(license, 'balanz_cfdi', now).billing
        .nextBillingTime,
    ).toBeNull();
    expect(
      BillingLicenseMapper.toResolveDto(null, 'balanz_cfdi', now).billing
        .nextBillingTime,
    ).toBeNull();
  });
});

describe('license resolution', () => {
  it.each([false, true])(
    'preserves renewal with a minimal subscription load (fallback: %s)',
    async (fallback) => {
      const license = fixture();
      license.validUntil = new Date('2099-01-01T00:00:00Z');
      const findOne = jest.fn();
      if (fallback) findOne.mockResolvedValueOnce(null);
      findOne.mockResolvedValue(license);
      const calculated = BillingLicenseMapper.toResolveDto(
        license,
        'balanz_cfdi',
      );
      const resolveForSubscription = jest.fn().mockResolvedValue(calculated);
      const service = new BillingLicensesService(
        { findOne } as unknown as Repository<BillingLicenseEntity>,
        { resolveForSubscription } as unknown as BillingEntitlementsService,
      );
      const result = await service.resolveLicense(
        'organization',
        'balanz_cfdi',
      );
      expect(result.billing.nextBillingTime).toBe(renewal.toISOString());
      expect(result.subscriptionId).toBe('subscription');
      expect(resolveForSubscription).toHaveBeenCalledWith(
        'subscription',
        undefined,
      );
      expect(findOne).toHaveBeenCalledTimes(fallback ? 2 : 1);
      for (const [options] of findOne.mock.calls) {
        expect(options).toEqual(
          expect.objectContaining({ relations: { subscription: true } }),
        );
      }
    },
  );
});
