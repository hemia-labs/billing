import { EntityManager } from 'typeorm';
import {
  BillingCheckoutSessionEntity,
  BillingCheckoutSessionStatus,
  BillingSubscriptionEntity,
  SubscriptionStatus,
} from '../billing-shared';
import type { PaypalSubscriptionDetails } from '../paypal/types';

export type PlanChangeState =
  'preparing' | 'awaiting_approval' | 'scheduled' | 'effective' | 'failed';
export type PendingPlanChange = {
  idempotencyKey: string;
  requestHash: string;
  state: PlanChangeState;
  targetPlanCode: string;
  targetPlanPriceCode: string;
  targetProviderPlanId: string;
  effectiveAt: string;
  checkoutId: string;
  newSubscriptionId: string;
  requestedAt: string;
  requestedEffectiveAt?: string;
  approvedAt?: string;
  leaseToken?: string;
  leaseUntil?: string;
};
export type CancellationIntent = {
  idempotencyKey: string;
  actorUserId: string;
  reason: string | null;
  state: 'pending' | 'scheduled';
  requestedAt: string;
  effectiveAt: string | null;
  leaseToken?: string;
  leaseUntil?: string;
};
export function pendingPlanChange(
  subscription: BillingSubscriptionEntity,
): PendingPlanChange | null {
  const value = subscription.metadata?.pendingPlanChange;
  return value &&
    typeof value === 'object' &&
    'state' in value &&
    'checkoutId' in value
    ? (value as PendingPlanChange)
    : null;
}
export function cancellationIntent(
  subscription: BillingSubscriptionEntity,
): CancellationIntent | null {
  const value = subscription.metadata?.cancellation;
  return value &&
    typeof value === 'object' &&
    'idempotencyKey' in value &&
    'state' in value
    ? (value as CancellationIntent)
    : null;
}

// PayPal ACTIVE refers to the existing agreement; only the target provider plan proves consent.
// Keep the contracted catalog version until its paid cycle ends and the new cycle is paid.
export async function applyConfirmedPlanChange(
  manager: EntityManager,
  subscription: BillingSubscriptionEntity,
  provider: PaypalSubscriptionDetails,
  now = new Date(),
  approvalOccurredAt?: string,
): Promise<void> {
  const change = pendingPlanChange(subscription);
  if (
    !change ||
    change.state === 'failed' ||
    change.state === 'effective' ||
    subscription.metadata.refundRevocation
  )
    return;
  if (
    provider.planId !== change.targetProviderPlanId ||
    provider.status !== 'ACTIVE'
  )
    return;
  const billing =
    provider.billingInfo ??
    (provider.raw.billing_info as Record<string, unknown> | undefined);
  const payment = billing?.last_payment as { time?: string } | undefined;
  const paidAt = payment?.time ? Date.parse(payment.time) : NaN;
  const originalBoundary = Date.parse(
    change.requestedEffectiveAt ?? change.effectiveAt,
  );
  const occurredAt = approvalOccurredAt ? Date.parse(approvalOccurredAt) : NaN;
  if (
    Number.isFinite(occurredAt) &&
    occurredAt >= Date.parse(change.requestedAt) &&
    occurredAt <= now.getTime() &&
    (!change.approvedAt || occurredAt < Date.parse(change.approvedAt))
  )
    change.approvedAt = new Date(occurredAt).toISOString();
  if (!change.approvedAt && now.getTime() < originalBoundary)
    change.approvedAt = now.toISOString();
  // A generic provider update_time is not consent evidence after a missed billing boundary.
  if (!change.approvedAt) return;
  if (Date.parse(change.approvedAt) < originalBoundary)
    change.effectiveAt = new Date(originalBoundary).toISOString();
  else {
    const next =
      typeof billing?.next_billing_time === 'string'
        ? Date.parse(billing.next_billing_time)
        : NaN;
    if (paidAt > Date.parse(change.approvedAt))
      change.effectiveAt = new Date(paidAt).toISOString();
    else if (Number.isFinite(next) && next > Date.parse(change.approvedAt))
      change.effectiveAt = new Date(next).toISOString();
    else return;
  }
  change.state = 'scheduled';
  const checkout = await manager
    .getRepository(BillingCheckoutSessionEntity)
    .findOne({
      where: {
        id: change.checkoutId,
        organizationId: subscription.organizationId,
        productCode: subscription.productCode,
      },
      relations: {
        plan: {
          versions: {
            prices: { providerPrices: true },
            entitlements: { feature: true },
          },
        },
        planPrice: true,
        providerPrice: true,
      },
    });
  if (
    !checkout ||
    checkout.metadata.subscriptionId !== subscription.id ||
    checkout.plan.code !== change.targetPlanCode ||
    checkout.planPriceCode !== change.targetPlanPriceCode
  )
    throw new Error('Scheduled plan checkout mismatch');
  if (
    now.getTime() >= Date.parse(change.effectiveAt) &&
    paidAt >= Date.parse(change.effectiveAt)
  ) {
    Object.assign(subscription, {
      planId: checkout.planId,
      plan: checkout.plan,
      planCode: change.targetPlanCode,
      planPriceId: checkout.planPriceId,
      planPrice: checkout.planPrice,
      planPriceCode: checkout.planPriceCode,
      providerPriceId: checkout.providerPriceId,
      providerPrice: checkout.providerPrice,
      legalAcceptanceId: checkout.legalAcceptanceId,
      acceptedAt: checkout.acceptedAt,
      legalSnapshotHash: checkout.legalSnapshotHash,
    });
    subscription.metadata = {
      ...subscription.metadata,
      ...(checkout.metadata.legalEvidence
        ? { legalEvidence: checkout.metadata.legalEvidence }
        : {}),
    };
    change.state = 'effective';
  }
  subscription.metadata = {
    ...subscription.metadata,
    pendingPlanChange: change,
  };
  await manager
    .getRepository(BillingCheckoutSessionEntity)
    .update(change.checkoutId, {
      status: BillingCheckoutSessionStatus.Approved,
      metadata: {
        ...checkout.metadata,
        planChangeState: change.state,
        planChangeEffectiveAt: change.effectiveAt,
      },
    });
}

export function hasPaidCancellationAccess(
  subscription: BillingSubscriptionEntity,
  now = Date.now(),
): boolean {
  const until = subscription.currentPeriodEnd ?? subscription.nextBillingTime;
  return (
    subscription.status === SubscriptionStatus.Cancelled &&
    subscription.cancelAtPeriodEnd &&
    !subscription.metadata?.refundRevocation &&
    !!until &&
    until.getTime() > now
  );
}
