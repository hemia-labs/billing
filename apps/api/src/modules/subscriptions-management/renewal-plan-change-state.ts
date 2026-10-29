import { EntityManager } from 'typeorm';
import {
  BillingCheckoutSessionEntity,
  BillingCheckoutSessionStatus,
  BillingSubscriptionEntity,
  SubscriptionStatus,
} from '../billing-shared';
import type { ProviderSubscription } from '../providers/billing-provider.types';
import {
  checkoutAbandonment,
  renewalResume,
} from './subscription-management-state';

export type RenewalPlanChange = {
  state:
    'preparing' | 'awaiting_approval' | 'scheduled' | 'effective' | 'failed';
  sourceSubscriptionId: string;
  renewalSubscriptionId: string;
  checkoutId: string;
  attemptId: string;
  targetPlanCode: string;
  targetPlanPriceCode: string;
  targetProviderPlanId: string;
  originalProviderPlanId: string;
  originalCheckoutId: string;
  effectiveAt: string;
  amountDueNow: '0.00';
  recurringAmount: string;
  currency: string;
  requestHash: string;
  approvalUrl?: string;
  cancelRequestedAt?: string;
  cancelApprovalUrl?: string;
  leaseToken?: string;
  leaseUntil?: string;
  cancellationGeneration?: number;
  conflictingAttemptId?: string;
};
export function renewalPlanChange(
  subscription: BillingSubscriptionEntity,
): RenewalPlanChange | undefined {
  return subscription.metadata.renewalPlanChange as
    RenewalPlanChange | undefined;
}
export function cancelledRenewalPlanChanges(
  subscription: BillingSubscriptionEntity,
): RenewalPlanChange[] {
  return (
    (subscription.metadata.cancelledRenewalPlanChanges as
      RenewalPlanChange[] | undefined) ?? []
  );
}
export function currentRenewalPlanChange(
  subscription: BillingSubscriptionEntity,
): RenewalPlanChange | undefined {
  const current = renewalPlanChange(subscription);
  if (current && !['failed', 'effective'].includes(current.state))
    return current;
  const resume = renewalResume(subscription);
  if (
    !resume ||
    resume.state !== 'scheduled' ||
    resume.paidCaptureId ||
    checkoutAbandonment(subscription) ||
    Date.parse(resume.effectiveAt) <= Date.now()
  )
    return undefined;
  return cancelledRenewalPlanChanges(subscription).find(
    (change) =>
      change.state === 'scheduled' &&
      !change.cancelRequestedAt &&
      change.checkoutId === resume.authorizedCheckoutId &&
      change.targetProviderPlanId === resume.providerPlanId &&
      change.sourceSubscriptionId === resume.sourceSubscriptionId &&
      change.renewalSubscriptionId === subscription.id &&
      change.effectiveAt === resume.effectiveAt,
  );
}
export function renewalPlanChangeResponse(
  subscription: BillingSubscriptionEntity,
  selected?: RenewalPlanChange,
) {
  const change = selected ?? renewalPlanChange(subscription);
  if (!change) return undefined;
  const terminal =
    ['effective', 'failed'].includes(change.state) ||
    (change.state === 'scheduled' && !change.cancelRequestedAt);
  return {
    state: change.state,
    sourceSubscriptionId: change.sourceSubscriptionId,
    renewalSubscriptionId: change.renewalSubscriptionId,
    targetPlanCode: change.targetPlanCode,
    targetPlanPriceCode: change.targetPlanPriceCode,
    effectiveAt: change.effectiveAt,
    amountDueNow: change.amountDueNow,
    recurringAmount: change.recurringAmount,
    currency: change.currency,
    cancellationRequested: !!change.cancelRequestedAt,
    action: terminal ? ('none' as const) : ('approve_subscription' as const),
    checkoutUrl: terminal
      ? null
      : change.cancelRequestedAt
        ? (change.cancelApprovalUrl ?? null)
        : (change.approvalUrl ?? null),
  };
}

// Only a provider-confirmed price is allowed to replace the future contract; never the paid source.
export async function applyRenewalPlanChangeObservation(
  manager: EntityManager,
  subscription: BillingSubscriptionEntity,
  provider: ProviderSubscription,
): Promise<void> {
  const change = renewalPlanChange(subscription),
    resume = renewalResume(subscription);
  if (
    !change ||
    !resume ||
    checkoutAbandonment(subscription) ||
    change.state === 'effective' ||
    provider.subscriptionStatus !== SubscriptionStatus.Active ||
    provider.id !== subscription.providerSubscriptionId
  )
    return;
  if (
    change.sourceSubscriptionId !== resume.sourceSubscriptionId ||
    change.renewalSubscriptionId !== subscription.id ||
    change.effectiveAt !== resume.effectiveAt
  )
    return;
  if (resume.paidCaptureId) return;
  const historical = cancelledRenewalPlanChanges(subscription).find(
    (item) =>
      item.targetProviderPlanId === provider.planId &&
      ![change.originalProviderPlanId, change.targetProviderPlanId].includes(
        provider.planId ?? '',
      ),
  );
  if (historical) {
    const suspended = {
      ...change,
      state: 'failed' as const,
      cancelRequestedAt: new Date().toISOString(),
    };
    delete suspended.leaseToken;
    delete suspended.leaseUntil;
    const previousCheckout = await manager
      .getRepository(BillingCheckoutSessionEntity)
      .findOne({ where: { id: suspended.checkoutId } });
    if (previousCheckout)
      await manager
        .getRepository(BillingCheckoutSessionEntity)
        .update(suspended.checkoutId, {
          status: BillingCheckoutSessionStatus.Cancelled,
          metadata: {
            ...previousCheckout.metadata,
            renewalPlanChange: renewalPlanChangeResponse(
              subscription,
              suspended,
            ),
          },
        });
    for (const key of Object.keys(change))
      delete (change as unknown as Record<string, unknown>)[key];
    Object.assign(change, historical, {
      state: 'awaiting_approval',
      originalProviderPlanId: resume.providerPlanId,
      originalCheckoutId: resume.authorizedCheckoutId ?? resume.checkoutId,
      cancelRequestedAt: new Date().toISOString(),
      cancellationGeneration: (historical.cancellationGeneration ?? 0) + 1,
    });
    delete change.cancelApprovalUrl;
    delete change.leaseToken;
    delete change.leaseUntil;
    subscription.metadata = {
      ...subscription.metadata,
      cancelledRenewalPlanChanges: [
        ...cancelledRenewalPlanChanges(subscription).filter(
          (item) =>
            item.attemptId !== historical.attemptId &&
            item.attemptId !== suspended.attemptId,
        ),
        suspended,
      ],
      renewalPlanChange: change,
    };
  }
  if (change.state === 'failed') {
    if (
      !change.cancelRequestedAt ||
      provider.planId !== change.targetProviderPlanId
    )
      return;
    // A previously issued approval may arrive after local cancellation. Recover an explicit restoration.
    change.state = 'awaiting_approval';
    change.cancellationGeneration = (change.cancellationGeneration ?? 0) + 1;
    delete change.cancelApprovalUrl;
    subscription.metadata = {
      ...subscription.metadata,
      renewalPlanChange: change,
    };
  }
  if (
    change.cancelRequestedAt &&
    provider.planId === change.targetProviderPlanId &&
    provider.lastPaymentAt &&
    Date.parse(provider.lastPaymentAt) >= Date.parse(change.effectiveAt)
  ) {
    delete change.cancelRequestedAt;
    delete change.cancelApprovalUrl;
    subscription.metadata = {
      ...subscription.metadata,
      renewalRevisionReview: {
        state: 'required',
        reason: 'cancellation_not_confirmed_before_billing',
      },
    };
  }
  if (
    change.cancelRequestedAt &&
    (Date.now() >= Date.parse(change.effectiveAt) ||
      (provider.lastPaymentAt &&
        Date.parse(provider.lastPaymentAt) >= Date.parse(change.effectiveAt)))
  )
    return;
  const selectedId = change.cancelRequestedAt
    ? change.originalProviderPlanId
    : change.targetProviderPlanId;
  if (provider.planId !== selectedId) return;
  const selectedCheckout = change.cancelRequestedAt
    ? change.originalCheckoutId
    : change.checkoutId;
  const checkout = await manager
    .getRepository(BillingCheckoutSessionEntity)
    .findOne({
      where: {
        id: selectedCheckout,
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
    checkout.providerPrice?.providerPriceId !== selectedId
  )
    throw new Error('Future renewal checkout mismatch');
  Object.assign(subscription, {
    planId: checkout.planId,
    plan: checkout.plan,
    planCode: checkout.plan.code,
    planPriceId: checkout.planPriceId,
    planPrice: checkout.planPrice,
    planPriceCode: checkout.planPriceCode,
    providerPriceId: checkout.providerPriceId,
    providerPrice: checkout.providerPrice,
  });
  resume.providerPlanId = selectedId;
  resume.recurringAmount = checkout.planPrice!.amount;
  resume.currency = checkout.planPrice!.currency;
  resume.authorizedCheckoutId = checkout.id;
  change.state = change.cancelRequestedAt ? 'failed' : 'scheduled';
  subscription.metadata = {
    ...subscription.metadata,
    renewalResume: resume,
    renewalPlanChange: change,
  };
  await manager
    .getRepository(BillingCheckoutSessionEntity)
    .update(change.checkoutId, {
      status:
        change.state === 'failed'
          ? BillingCheckoutSessionStatus.Cancelled
          : BillingCheckoutSessionStatus.Approved,
    });
}
