import { EntityManager } from 'typeorm';
import {
  BillingPaymentEntity,
  BillingPaymentRefundEntity,
  BillingProvider,
  BillingSubscriptionEntity,
  BillingWebhookEventEntity,
  LicenseStatus,
  PaymentStatus,
  SubscriptionStatus,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '../billing-shared';
import { providerConnectionId } from '../providers/provider-connection';
import type { BillingLicenseResolveResponseDto } from './dtos';

export type RefundConfirmation = {
  status: 'completed';
  type: 'full_current_period';
  organizationId: string;
  productCode: string;
  subscriptionId: string;
  paymentId: string;
  refundId: string;
  amount: string;
  currency: string;
  refundedAt: string;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const validDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());
const cents = (value: unknown): number | undefined => {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value)
  )
    return;
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return result > 0 && Number.isSafeInteger(result) ? result : undefined;
};

function captureId(resource: Record<string, unknown>): unknown {
  const related = record(record(resource.supplementary_data)?.related_ids);
  const direct = related?.capture_id ?? resource.capture_id;
  if (direct) return direct;
  if (!Array.isArray(resource.links)) return;
  for (const entry of resource.links) {
    const link = record(entry);
    if (link?.rel !== 'up' || typeof link.href !== 'string') continue;
    try {
      const url = new URL(link.href);
      if (
        url.protocol === 'https:' &&
        [
          'api.paypal.com',
          'api-m.paypal.com',
          'api.sandbox.paypal.com',
          'api-m.sandbox.paypal.com',
        ].includes(url.hostname)
      ) {
        const match = /^\/v2\/payments\/captures\/([A-Za-z0-9-]+)$/.exec(
          url.pathname,
        );
        if (match) return match[1];
      }
    } catch {
      // An invalid provider URL cannot prove a capture reference.
    }
  }
}

/** A refund proves loss of this paid period only when its processed webhook revoked it. */
export async function refundConfirmation(
  manager: EntityManager,
  subscription: BillingSubscriptionEntity,
  license: BillingLicenseResolveResponseDto,
  confirmedAt: Date,
): Promise<RefundConfirmation | undefined> {
  const marker = record(subscription.metadata?.refundRevocation);
  if (
    license.active !== false ||
    license.licenseStatus !== LicenseStatus.Revoked ||
    license.subscriptionId !== subscription.id ||
    license.productCode !== subscription.productCode ||
    subscription.status !== SubscriptionStatus.Cancelled ||
    subscription.cancelAtPeriodEnd ||
    subscription.provider !== BillingProvider.Paypal ||
    subscription.metadata?.checkoutAbandonment ||
    !marker ||
    typeof marker.paymentId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      marker.paymentId,
    ) ||
    typeof marker.refundId !== 'string'
  )
    return;

  const payment = await manager
    .getRepository(BillingPaymentEntity)
    .findOneBy({ id: marker.paymentId });
  if (
    !payment ||
    payment.id !== marker.paymentId ||
    payment.organizationId !== subscription.organizationId ||
    payment.subscriptionId !== subscription.id ||
    payment.provider !== subscription.provider ||
    payment.status !== PaymentStatus.Refunded ||
    !payment.providerCaptureId ||
    payment.metadata?.operation === 'plan_change_proration' ||
    payment.metadata?.subscriptionAddonId ||
    !cents(payment.amount) ||
    !/^[A-Z]{3}$/.test(payment.currency) ||
    !validDate(payment.periodStart) ||
    !validDate(payment.periodEnd) ||
    payment.periodStart >= payment.periodEnd ||
    marker.periodStart !== payment.periodStart.toISOString() ||
    marker.periodEnd !== payment.periodEnd.toISOString() ||
    !validDate(subscription.currentPeriodEnd) ||
    subscription.currentPeriodEnd.getTime() !== payment.periodEnd.getTime()
  )
    return;

  let connectionId: string | null;
  try {
    connectionId = providerConnectionId(subscription.metadata);
    if (providerConnectionId(payment.metadata) !== connectionId) return;
  } catch {
    return;
  }
  const refunds = await manager
    .getRepository(BillingPaymentRefundEntity)
    .find({ where: { paymentId: payment.id } });
  const finalRefund = refunds.find(
    (refund) => refund.providerRefundId === marker.refundId,
  );
  // PayPal cancellation refreshes validUntil to periodEnd while retaining Revoked.
  // The refund marker, paid period and processed events provide the durable proof.
  if (!finalRefund || !validDate(finalRefund.refundedAt)) return;

  let total = 0;
  const references = new Set<string>();
  for (const refund of refunds) {
    const amount = cents(refund.amount);
    if (
      refund.paymentId !== payment.id ||
      refund.provider !== payment.provider ||
      !refund.providerRefundId ||
      references.has(refund.providerRefundId) ||
      !amount ||
      refund.currency !== payment.currency ||
      !validDate(refund.refundedAt) ||
      refund.refundedAt < payment.periodStart ||
      refund.refundedAt >= payment.periodEnd ||
      refund.refundedAt > confirmedAt
    )
      return;
    references.add(refund.providerRefundId);
    total += amount;
    if (total > cents(payment.amount)!) return;
    const event = await manager
      .getRepository(BillingWebhookEventEntity)
      .findOneBy({ id: refund.webhookEventId });
    if (
      !event ||
      event.id !== refund.webhookEventId ||
      event.provider !== payment.provider ||
      (event.providerConnectionId ?? null) !== connectionId ||
      event.verificationStatus !== WebhookVerificationStatus.Verified ||
      event.processingStatus !== WebhookProcessingStatus.Processed ||
      event.requiresManualReview ||
      !['PAYMENT.SALE.REFUNDED', 'PAYMENT.CAPTURE.REFUNDED'].includes(
        event.eventType,
      ) ||
      event.resourceId !== refund.providerRefundId
    )
      return;
    const resource = record(event.payloadJson.resource);
    const money = record(resource?.amount);
    const capture = event.eventType === 'PAYMENT.CAPTURE.REFUNDED';
    const timestamp =
      typeof resource?.create_time === 'string'
        ? new Date(resource.create_time)
        : null;
    if (
      !resource ||
      resource.id !== refund.providerRefundId ||
      (capture ? captureId(resource) : resource.sale_id) !==
        payment.providerCaptureId ||
      String(capture ? resource.status : resource.state).toLowerCase() !==
        'completed' ||
      cents(capture ? money?.value : money?.total) !== amount ||
      (capture ? money?.currency_code : money?.currency) !== payment.currency ||
      !validDate(timestamp) ||
      timestamp.getTime() !== refund.refundedAt.getTime()
    )
      return;
  }
  if (total !== cents(payment.amount)) return;
  return {
    status: 'completed',
    type: 'full_current_period',
    organizationId: subscription.organizationId,
    productCode: subscription.productCode,
    subscriptionId: subscription.id,
    paymentId: payment.id,
    refundId: finalRefund.providerRefundId,
    amount: payment.amount,
    currency: payment.currency,
    refundedAt: finalRefund.refundedAt.toISOString(),
  };
}
