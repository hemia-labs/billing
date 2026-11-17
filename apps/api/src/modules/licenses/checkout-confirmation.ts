import { EntityManager, JsonContains } from 'typeorm';
import {
  BillingCheckoutSessionEntity,
  BillingCheckoutSessionStatus,
  BillingPaymentEntity,
  BillingPaymentRefundEntity,
  BillingProvider,
  BillingSubscriptionEntity,
  BillingWebhookEventEntity,
  PaymentStatus,
  PlanPriceBillingInterval,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '../billing-shared';
import { providerConnectionId } from '../providers/provider-connection';

export type CheckoutConfirmation = {
  status: 'completed';
  organizationId: string;
  productCode: string;
  subscriptionId: string;
  paymentId: string;
  userId: string;
  planCode: string;
  planPriceCode: string;
  planName: null;
  recurringAmount: string;
  currency: string;
  billingInterval: PlanPriceBillingInterval;
  billingIntervalCount: number;
  paidAmount: string;
  paidAt: string;
  provider: 'paypal';
  nextBillingAt: string | null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const positiveMoney = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(0|[1-9]\d{0,9})\.\d{2}$/.test(value) &&
  /[1-9]/.test(value);
const validDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

/** Optional, proven checkout facts; absence never grants or revokes a license. */
export async function checkoutConfirmation(
  manager: EntityManager,
  subscription: BillingSubscriptionEntity,
  confirmedAt: Date,
): Promise<CheckoutConfirmation | undefined> {
  const metadata = subscription.metadata ?? {};
  if (
    subscription.provider !== BillingProvider.Paypal ||
    metadata.renewalResume ||
    metadata.checkoutAbandonment ||
    metadata.refundRevocation ||
    !subscription.providerSubscriptionId
  )
    return;

  const checkout = await manager
    .getRepository(BillingCheckoutSessionEntity)
    .findOne({
      where: {
        organizationId: subscription.organizationId,
        productCode: subscription.productCode,
        metadata: JsonContains({ subscriptionId: subscription.id }),
      },
      relations: { planPrice: { planVersion: true } },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  const price = checkout?.planPrice;
  if (
    !checkout ||
    checkout.deletedAt ||
    checkout.organizationId !== subscription.organizationId ||
    checkout.productCode !== subscription.productCode ||
    checkout.metadata.subscriptionId !== subscription.id ||
    checkout.provider !== subscription.provider ||
    checkout.metadata.operation ||
    checkout.metadata.renewalResume ||
    ![
      BillingCheckoutSessionStatus.Created,
      BillingCheckoutSessionStatus.Pending,
      BillingCheckoutSessionStatus.Approved,
    ].includes(checkout.status) ||
    !uuid.test(checkout.userId) ||
    checkout.planId !== subscription.planId ||
    checkout.planPriceId !== subscription.planPriceId ||
    checkout.providerPriceId !== subscription.providerPriceId ||
    !price ||
    price.id !== checkout.planPriceId ||
    price.planVersion?.planId !== checkout.planId ||
    price.code !== checkout.planPriceCode ||
    price.code !== subscription.planPriceCode ||
    !subscription.planCode ||
    !positiveMoney(price.amount) ||
    !/^[A-Z]{3}$/.test(price.currency) ||
    ![PlanPriceBillingInterval.Month, PlanPriceBillingInterval.Year].includes(
      price.billingInterval,
    ) ||
    !Number.isSafeInteger(price.billingIntervalCount) ||
    price.billingIntervalCount < 1
  )
    return;

  // Choose before checking status/refunds: a later renewal cannot replace an initial refunded sale.
  const payment = await manager
    .getRepository(BillingPaymentEntity)
    .createQueryBuilder('payment')
    .where('payment.subscriptionId = :subscriptionId', {
      subscriptionId: subscription.id,
    })
    .orderBy('COALESCE(payment.paidAt, payment.createdAt)', 'ASC')
    .addOrderBy('payment.createdAt', 'ASC')
    .addOrderBy('payment.id', 'ASC')
    .getOne();
  if (
    !payment ||
    payment.organizationId !== subscription.organizationId ||
    payment.subscriptionId !== subscription.id ||
    payment.provider !== subscription.provider ||
    payment.status !== PaymentStatus.Paid ||
    !payment.rawEventId ||
    payment.metadata.operation ||
    payment.metadata.subscriptionAddonId ||
    payment.metadata.refundReview ||
    payment.metadata.renewalResumeReview ||
    !positiveMoney(payment.amount) ||
    payment.currency !== price.currency ||
    !validDate(payment.paidAt) ||
    !validDate(checkout.createdAt) ||
    payment.paidAt < checkout.createdAt ||
    payment.paidAt > confirmedAt
  )
    return;

  const initial = payment.metadata.initialCheckoutPayment as
    | {
        providerSubscriptionId?: unknown;
        paidAt?: unknown;
        regularCyclesCompleted?: unknown;
      }
    | undefined;
  if (
    initial?.providerSubscriptionId !== subscription.providerSubscriptionId ||
    initial?.paidAt !== payment.paidAt.toISOString() ||
    initial?.regularCyclesCompleted !== 1
  )
    return;

  const event = await manager
    .getRepository(BillingWebhookEventEntity)
    .findOneBy({ id: payment.rawEventId });
  if (
    !event ||
    event.provider !== subscription.provider ||
    event.eventType !== 'PAYMENT.SALE.COMPLETED' ||
    event.verificationStatus !== WebhookVerificationStatus.Verified ||
    event.processingStatus !== WebhookProcessingStatus.Processed ||
    event.requiresManualReview
  )
    return;
  const resource = event.payloadJson.resource;
  if (!resource || typeof resource !== 'object' || Array.isArray(resource))
    return;
  const sale = resource as Record<string, unknown>;
  const related = sale.supplementary_data as
    { related_ids?: { subscription_id?: unknown } } | undefined;
  const providerSubscriptionId =
    sale.billing_agreement_id ??
    sale.subscription_id ??
    related?.related_ids?.subscription_id;
  const paidAt =
    typeof sale.create_time === 'string' ? new Date(sale.create_time) : null;
  if (
    providerSubscriptionId !== subscription.providerSubscriptionId ||
    sale.id !== payment.providerCaptureId ||
    event.resourceId !== payment.providerCaptureId ||
    !['completed', 'COMPLETED'].includes(String(sale.state ?? sale.status)) ||
    !validDate(paidAt) ||
    paidAt.getTime() !== payment.paidAt.getTime()
  )
    return;
  try {
    const connectionId = providerConnectionId(metadata);
    if (
      providerConnectionId(checkout.metadata) !== connectionId ||
      providerConnectionId(payment.metadata) !== connectionId ||
      (event.providerConnectionId ?? null) !== connectionId
    )
      return;
  } catch {
    return;
  }
  if (
    await manager
      .getRepository(BillingPaymentRefundEntity)
      .existsBy({ paymentId: payment.id })
  )
    return;

  return {
    status: 'completed',
    organizationId: subscription.organizationId,
    productCode: subscription.productCode,
    subscriptionId: subscription.id,
    paymentId: payment.id,
    userId: checkout.userId,
    planCode: subscription.planCode,
    planPriceCode: price.code,
    // Names are mutable on the plan; existing checkouts did not freeze one.
    planName: null,
    recurringAmount: price.amount,
    currency: price.currency,
    billingInterval: price.billingInterval,
    billingIntervalCount: price.billingIntervalCount,
    paidAmount: payment.amount,
    paidAt: payment.paidAt.toISOString(),
    provider: 'paypal',
    nextBillingAt: validDate(subscription.nextBillingTime)
      ? subscription.nextBillingTime.toISOString()
      : null,
  };
}
