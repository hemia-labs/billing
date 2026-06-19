import { BillingLicenseEntity } from '../../billing-shared';
import {
  BillingAmountsSummary,
  BillingEntitlementsSummary,
} from '../../entitlements';
import { LicenseStatus } from '../../billing-shared';
import { BillingLicenseResolveResponseDto } from '../dtos';

const EMPTY_ENTITLEMENTS: BillingEntitlementsSummary = {
  maxUsers: 0,
  includedUsers: 0,
  extraUsers: 0,
  maxAgents: 0,
  maxConversationsMonthly: null,
};

const EMPTY_BILLING: BillingAmountsSummary = {
  baseMonthly: '0.00',
  addonsMonthly: '0.00',
  totalMonthly: '0.00',
  currency: 'MXN',
};

export class BillingLicenseMapper {
  static toResolveDto(
    license: BillingLicenseEntity | null,
    productCode: string,
    now = new Date(),
    calculated?: {
      entitlements: BillingEntitlementsSummary;
      billing: BillingAmountsSummary;
    },
  ): BillingLicenseResolveResponseDto {
    if (!license) {
      return {
        active: false,
        productCode,
        planCode: null,
        licenseStatus: LicenseStatus.Revoked,
        validUntil: null,
        seatsLimit: 0,
        usageLimit: null,
        features: {},
        subscriptionId: null,
        entitlements: calculated?.entitlements ?? EMPTY_ENTITLEMENTS,
        billing: calculated?.billing ?? EMPTY_BILLING,
      };
    }

    const entitlements = calculated?.entitlements ?? {
      ...EMPTY_ENTITLEMENTS,
      maxUsers: license.seatsLimit,
      includedUsers: license.seatsLimit,
    };

    return {
      active: this.isAccessActive(license, now),
      productCode: license.productCode,
      planCode: license.planCode,
      licenseStatus: license.status,
      validUntil: license.validUntil?.toISOString() ?? null,
      seatsLimit: entitlements.maxUsers,
      usageLimit: entitlements.maxConversationsMonthly,
      features: license.featuresJson,
      subscriptionId: license.subscriptionId,
      entitlements,
      billing: calculated?.billing ?? EMPTY_BILLING,
    };
  }

  private static isAccessActive(
    license: BillingLicenseEntity,
    now: Date,
  ): boolean {
    if (license.status === LicenseStatus.Active) {
      return !license.validUntil || license.validUntil > now;
    }

    if (license.status === LicenseStatus.Grace) {
      return !!license.validUntil && license.validUntil > now;
    }

    return false;
  }
}
