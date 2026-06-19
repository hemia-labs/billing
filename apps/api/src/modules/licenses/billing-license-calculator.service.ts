import { Injectable } from '@nestjs/common';
import {
  BillingLicenseEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import { LicenseStatus } from '../billing-shared';

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
  calculate(
    input: BillingLicenseCalculationInput,
  ): BillingLicenseCalculationResult {
    const plan = input.subscription.plan as BillingPlanEntity | undefined;

    return {
      organizationId: input.subscription.organizationId,
      productId: input.product.id,
      productCode: input.subscription.productCode,
      subscriptionId: input.subscription.id,
      planCode: input.subscription.planCode,
      licenseKeyHash: input.license?.licenseKeyHash ?? null,
      status: input.status,
      seatsLimit: plan?.seatsIncluded ?? 0,
      usageLimit: null,
      featuresJson: plan?.featuresJson ?? {},
      validUntil:
        input.status === LicenseStatus.Grace
          ? input.subscription.graceUntil
          : input.subscription.nextBillingTime,
    };
  }
}
