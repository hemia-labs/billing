import {
  cancellationIntent,
  pendingPlanChange,
  planChangeResponse,
} from '../subscription-management-state';
import { BillingEntitlementsResolution } from '../../entitlements';
import { BillingSubscriptionEntity } from '../../billing-shared';
import { BillingSubscriptionManagementResponseDto } from '../dtos';

export class SubscriptionManagementMapper {
  static toResponse(
    subscription: BillingSubscriptionEntity,
    resolution: BillingEntitlementsResolution,
  ): BillingSubscriptionManagementResponseDto {
    const cancellation = cancellationIntent(subscription);
    const change = pendingPlanChange(subscription);
    return {
      planPriceCode: subscription.planPriceCode ?? null,
      cancellation: cancellation
        ? {
            state: cancellation.state,
            requestedAt: cancellation.requestedAt,
            effectiveAt: cancellation.effectiveAt,
          }
        : null,
      pendingPlanChange:
        change && change.state !== 'failed'
          ? {
              ...planChangeResponse(change),
              ...(typeof change.idempotencyKey === 'string' &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                change.idempotencyKey,
              )
                ? { attemptId: change.idempotencyKey.toLowerCase() }
                : {}),
              state: change.state,
              targetPlanCode: change.targetPlanCode,
              targetPlanPriceCode: change.targetPlanPriceCode,
              effectiveAt: change.effectiveAt,
              checkoutId: change.checkoutId,
              newSubscriptionId: subscription.id,
            }
          : null,
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
        amount:
          subscription.planPrice?.amount ?? resolution.billing.baseMonthly,
        currency:
          subscription.planPrice?.currency ?? resolution.billing.currency,
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
