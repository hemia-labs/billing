import { BillingLicenseEntity } from 'src/modules/billing-shared';
import { LicenseStatus } from 'src/modules/billing-shared';
import { BillingLicenseCalculatorService } from 'src/modules/licenses/billing-license-calculator.service';

const product = {
  id: 'product-id',
  code: 'medsync',
};

const subscription = {
  id: 'subscription-id',
  organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
  productCode: 'medsync',
  planCode: 'medsync_pro_monthly',
  nextBillingTime: new Date('2026-07-18T00:00:00Z'),
  graceUntil: new Date('2026-06-25T00:00:00Z'),
  plan: {
    seatsIncluded: 5,
    featuresJson: { users: 5, exports: true },
  },
};

describe('BillingLicenseCalculatorService', () => {
  let service: BillingLicenseCalculatorService;

  beforeEach(() => {
    service = new BillingLicenseCalculatorService();
  });

  it('calculates active license from subscription and plan', () => {
    expect(
      service.calculate({
        product: product as never,
        subscription: subscription as never,
        status: LicenseStatus.Active,
      }),
    ).toEqual({
      organizationId: subscription.organizationId,
      productId: 'product-id',
      productCode: 'medsync',
      subscriptionId: 'subscription-id',
      planCode: 'medsync_pro_monthly',
      licenseKeyHash: null,
      status: LicenseStatus.Active,
      seatsLimit: 5,
      usageLimit: null,
      featuresJson: { users: 5, exports: true },
      validUntil: new Date('2026-07-18T00:00:00Z'),
    });
  });

  it('uses graceUntil when license is in grace', () => {
    const result = service.calculate({
      product: product as never,
      subscription: subscription as never,
      status: LicenseStatus.Grace,
    });

    expect(result.validUntil).toEqual(new Date('2026-06-25T00:00:00Z'));
  });

  it('preserves existing license key hash', () => {
    const result = service.calculate({
      license: { licenseKeyHash: 'hash-123' } as BillingLicenseEntity,
      product: product as never,
      subscription: subscription as never,
      status: LicenseStatus.Active,
    });

    expect(result.licenseKeyHash).toBe('hash-123');
  });
});
