import {
  checkoutAbandonment,
  renewalResumePending,
} from '../subscriptions-management/subscription-management-state';
import { Injectable } from '@nestjs/common';
import { BillingPlanCatalogResolver } from '../catalog';
import {
  BillingLicenseEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import { LicenseStatus, SubscriptionStatus } from '../billing-shared';

export interface BillingLicenseCalculationInput {
  license?: BillingLicenseEntity | null;
  product: BillingProductEntity;
  subscription: BillingSubscriptionEntity;
  status: LicenseStatus;
}

export interface BillingLicenseCalculationResult {
  organizationId: string;
  productId: string;
  productCode: string;
  subscriptionId: string;
  planCode: string;
  licenseKeyHash: string | null;
  status: LicenseStatus;
  seatsLimit: number;
  usageLimit: number | null;
  featuresJson: Record<string, unknown>;
  validUntil: Date | null;
}

@Injectable()
export class BillingLicenseCalculatorService {
  constructor(private readonly planResolver: BillingPlanCatalogResolver) {}

  calculate(
    input: BillingLicenseCalculationInput,
  ): BillingLicenseCalculationResult {
    const paidThrough =
      input.subscription.currentPeriodEnd ?? input.subscription.nextBillingTime;
    const scheduledCancellation =
      input.subscription.status === SubscriptionStatus.Cancelled &&
      input.subscription.cancelAtPeriodEnd;
    // The separate future replacement has no paid license; its source remains unchanged.
    const status =
      checkoutAbandonment(input.subscription) ||
      renewalResumePending(input.subscription)
        ? LicenseStatus.Revoked
        : scheduledCancellation &&
            paidThrough &&
            paidThrough.getTime() > Date.now()
          ? LicenseStatus.Active
          : input.status;
    const version = input.subscription.plan
      ? this.planResolver.contractVersion(input.subscription)
      : null;
    const featuresJson = version ? this.planResolver.entitlements(version) : {};
    const seatsLimit =
      this.numberFeature(featuresJson['users.included']) ??
      this.numberFeature(featuresJson['users.max']) ??
      0;

    return {
      organizationId: input.subscription.organizationId,
      productId: input.product.id,
      productCode: input.subscription.productCode,
      subscriptionId: input.subscription.id,
      planCode: input.subscription.planCode,
      licenseKeyHash: input.license?.licenseKeyHash ?? null,
      status,
      seatsLimit,
      usageLimit: null,
      featuresJson,
      validUntil:
        status === LicenseStatus.Grace
          ? input.subscription.graceUntil
          : scheduledCancellation || input.subscription.cancelAtPeriodEnd
            ? paidThrough
            : (input.subscription.nextBillingTime ??
              input.subscription.currentPeriodEnd),
    };
  }

  private numberFeature(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
