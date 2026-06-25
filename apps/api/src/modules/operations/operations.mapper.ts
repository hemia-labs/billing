import {
  BillingCheckoutSessionEntity,
  BillingLicenseEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import {
  ConsoleCheckoutResponseDto,
  ConsoleLicenseResponseDto,
  ConsoleSubscriptionResponseDto,
} from './dtos';

export class BillingOperationsMapper {
  static subscription(
    subscription: BillingSubscriptionEntity,
  ): ConsoleSubscriptionResponseDto {
    return {
      id: subscription.id,
      organizationId: subscription.organizationId,
      productCode: subscription.productCode,
      planCode: subscription.planCode,
      provider: subscription.provider,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      nextBillingTime: subscription.nextBillingTime,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      graceUntil: subscription.graceUntil,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    };
  }

  static checkout(
    checkout: BillingCheckoutSessionEntity,
  ): ConsoleCheckoutResponseDto {
    return {
      id: checkout.id,
      organizationId: checkout.organizationId,
      subscriptionId: BillingOperationsMapper.subscriptionId(checkout.metadata),
      productCode: checkout.productCode,
      planCode: checkout.plan.code,
      provider: checkout.provider,
      status: checkout.status,
      createdAt: checkout.createdAt,
      updatedAt: checkout.updatedAt,
    };
  }

  static license(license: BillingLicenseEntity): ConsoleLicenseResponseDto {
    return {
      id: license.id,
      organizationId: license.organizationId,
      productCode: license.productCode,
      planCode: license.planCode,
      subscriptionId: license.subscriptionId,
      status: license.status,
      seatsLimit: license.seatsLimit,
      usageLimit: license.usageLimit,
      features: license.featuresJson,
      validUntil: license.validUntil,
      createdAt: license.createdAt,
      updatedAt: license.updatedAt,
    };
  }

  private static subscriptionId(
    metadata: Record<string, unknown>,
  ): string | null {
    return typeof metadata.subscriptionId === 'string'
      ? metadata.subscriptionId
      : null;
  }
}
