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
        amount: subscription.plan.amount,
        currency: subscription.plan.currency,
        billingInterval: subscription.plan.billingInterval,
        seatsIncluded: subscription.plan.seatsIncluded,
      },
      entitlements: resolution.entitlements,
      billing: resolution.billing,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    };
  }
}
