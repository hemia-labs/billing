import { BillingEntitlementsResolution } from '../../entitlements';
import { BillingSubscriptionEntity } from '../../billing-shared';
import { BillingSubscriptionManagementResponseDto } from '../dtos';

export class SubscriptionManagementMapper {
  static toResponse(
    subscription: BillingSubscriptionEntity,
    resolution: BillingEntitlementsResolution,
  ): BillingSubscriptionManagementResponseDto {
    return {
      id: subscription.id,
      organizationId: subscription.organizationId,
      productCode: subscription.productCode,
      planCode: subscription.planCode,
      provider: subscription.provider,
      providerSubscriptionId: subscription.providerSubscriptionId,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      nextBillingTime: subscription.nextBillingTime,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      graceUntil: subscription.graceUntil,
      plan: {
        id: subscription.plan.id,
        code: subscription.plan.code,
        amount: subscription.planPrice?.amount ?? resolution.billing.baseMonthly,
        currency: subscription.planPrice?.currency ?? resolution.billing.currency,
        billingInterval: subscription.planPrice?.billingInterval ?? '',
        seatsIncluded: resolution.entitlements.includedUsers,
      },
      entitlements: resolution.entitlements,
      billing: resolution.billing,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    };
  }
}
