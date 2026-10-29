import { Injectable, Optional } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { BillingAuditService } from '../../audit';
import {
  BillingLicenseEntity,
  BillingPaymentEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingPaymentRefundEntity,
  BillingProvider,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
  LicenseStatus,
  PaymentStatus,
  SubscriptionAddonStatus,
  SubscriptionStatus,
  WebhookProcessingStatus,
} from '../../billing-shared';
import { BillingLicenseCalculatorService } from '../../licenses';
import {
  cancellationIntent,
  checkoutAbandonment,
  pendingPlanChange,
} from '../../subscriptions-management/subscription-management-state';
import type {
  BillingWebhookProcessorInput,
  BillingWebhookProcessorResult,
} from '../types';

@Injectable()
export class BillingPaypalRefundsService {
  constructor(
    private readonly audit: BillingAuditService,
    @Optional()
    private readonly licenseCalculator?: BillingLicenseCalculatorService,
  ) {}

  async process(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
  ): Promise<BillingWebhookProcessorResult> {
    const refundId = this.stringOrNull(input.resource.id);
    const captureRefund = input.eventType === 'PAYMENT.CAPTURE.REFUNDED';
    const saleId = captureRefund
      ? this.captureId(input.resource)
      : this.stringOrNull(input.resource.sale_id);
    const amount = this.asRecord(input.resource.amount);
    const refundCents = this.moneyCents(
      captureRefund ? amount?.value : amount?.total,
    );
    const currency = this.stringOrNull(
      captureRefund ? amount?.currency_code : amount?.currency,
    );
    const refundState = this.stringOrNull(
      captureRefund ? input.resource.status : input.resource.state,
    )?.toLowerCase();
    const refundedAt =
      this.dateOrNull(input.resource.create_time) ?? new Date();

    if (
      !refundId ||
      !saleId ||
      refundCents === null ||
      refundCents <= 0 ||
      !currency ||
      currency.length !== 3 ||
      (refundState && refundState !== 'completed')
    ) {
      return this.failed('Invalid PayPal refund details');
    }

    const [lockedPayment] = await manager.query<{ id: string }[]>(
      'SELECT id FROM payments WHERE provider=$1 AND provider_capture_id=$2',
      [BillingProvider.Paypal, saleId],
    );
    if (!lockedPayment) return this.failed('Payment not found');

    const payments = manager.getRepository(BillingPaymentEntity);
    let payment = await payments.findOne({
      where: { id: lockedPayment.id },
      relations: { subscription: true },
    });
    if (!payment) return this.failed('Payment not found');

    // Captures and refunds serialize on the subscription before the payment.
    if (payment.subscriptionId) {
      await manager.getRepository(BillingSubscriptionEntity).findOne({
        where: { id: payment.subscriptionId },
        lock: { mode: 'pessimistic_write' },
      });
    }
    await manager.query('SELECT id FROM payments WHERE id=$1 FOR UPDATE', [
      payment.id,
    ]);
    payment = await payments.findOne({
      where: { id: payment.id },
      relations: { subscription: true },
    });
    if (!payment) return this.failed('Payment not found');

    const refunds = manager.getRepository(BillingPaymentRefundEntity);
    const previousRefund = await refunds.findOne({
      where: { provider: BillingProvider.Paypal, providerRefundId: refundId },
    });
    const amountText = (refundCents / 100).toFixed(2);
    if (previousRefund) {
      if (
        previousRefund.paymentId !== payment.id ||
        previousRefund.amount !== amountText ||
        previousRefund.currency !== currency
      ) {
        return this.failed('PayPal refund reference mismatch');
      }
      return { processingStatus: WebhookProcessingStatus.Processed };
    }
    if (payment.currency !== currency) {
      return this.failed('PayPal refund currency mismatch');
    }

    const refund = await refunds.save(
      refunds.create({
        provider: BillingProvider.Paypal,
        providerRefundId: refundId,
        paymentId: payment.id,
        webhookEventId: input.eventId,
        amount: amountText,
        currency,
        refundedAt,
      }),
    );
    const recordedRefunds = await refunds.find({
      where: { paymentId: payment.id },
    });
    const refundedCents = recordedRefunds.reduce(
      (sum, item) => sum + (this.moneyCents(item.amount) ?? 0),
      0,
    );
    const paymentCents = this.moneyCents(payment.amount);
    if (paymentCents === null || refundedCents > paymentCents) {
      throw new Error('PayPal refunds exceed the original payment');
    }

    const fullyRefunded = refundedCents === paymentCents;
    const previousStatus = payment.status;
    if (fullyRefunded) {
      payment.status = PaymentStatus.Refunded;
      if (payment.metadata?.refundReview)
        payment.metadata = {
          ...payment.metadata,
          refundReview: { state: 'completed', refundId },
        };
    }
    await payments.save(payment);

    await this.audit.record({
      manager,
      organizationId: payment.organizationId,
      action: 'billing.payment.refunded',
      resourceType: 'billing_payment_refund',
      resourceId: refund.id,
      provider: BillingProvider.Paypal,
      metadata: {
        paymentId: payment.id,
        refundId: refund.id,
        providerRefundId: refundId,
        providerEventId: input.providerEventId,
        webhookEventId: input.eventId,
        previousStatus,
        newStatus: payment.status,
        refundedAmount: amountText,
        currency,
        outcome: fullyRefunded ? 'fully_refunded' : 'partially_refunded',
      },
    });

    if (!fullyRefunded || !payment.subscription) {
      return { processingStatus: WebhookProcessingStatus.Processed };
    }

    if (checkoutAbandonment(payment.subscription)) {
      const abandoned = await manager
        .getRepository(BillingSubscriptionEntity)
        .findOne({
          where: { id: payment.subscription.id },
          lock: { mode: 'pessimistic_write' },
        });
      const marker = abandoned && checkoutAbandonment(abandoned);
      if (abandoned && marker) {
        marker.refundReview = {
          state: 'completed',
          reason: 'abandoned_checkout',
          detectedAt: refundedAt.toISOString(),
          refundId,
        };
        abandoned.metadata = {
          ...abandoned.metadata,
          checkoutAbandonment: marker,
        };
        await manager.getRepository(BillingSubscriptionEntity).save(abandoned);
      }
      return { processingStatus: WebhookProcessingStatus.Processed };
    }
    const periodStart = payment.periodStart;
    const periodEnd = payment.periodEnd;
    if (!periodStart || !periodEnd) {
      await this.audit.record({
        manager,
        organizationId: payment.organizationId,
        action: 'billing.refund.period_review_required',
        resourceType: 'billing_payment_refund',
        resourceId: refund.id,
        provider: BillingProvider.Paypal,
        metadata: {
          paymentId: payment.id,
          refundId: refund.id,
          providerEventId: input.providerEventId,
          outcome: 'period_unknown',
        },
      });
      return { processingStatus: WebhookProcessingStatus.Processed };
    }

    if (
      refundedAt < periodStart ||
      refundedAt >= periodEnd ||
      periodEnd <= new Date()
    ) {
      return { processingStatus: WebhookProcessingStatus.Processed };
    }

    const subscriptions = manager.getRepository(BillingSubscriptionEntity);
    const subscription = await subscriptions.findOne({
      where: { id: payment.subscription.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!subscription) return this.failed('Subscription not found');

    if (checkoutAbandonment(subscription))
      return { processingStatus: WebhookProcessingStatus.Processed };
    const marker = subscription.metadata.refundRevocation;
    if (marker && typeof marker === 'object') {
      return { processingStatus: WebhookProcessingStatus.Processed };
    }

    if (payment.metadata?.operation === 'plan_change_proration') {
      await this.restoreProration(
        manager,
        subscription,
        payment,
        refundedAt,
        refundId,
      );
      return { processingStatus: WebhookProcessingStatus.Processed };
    }

    subscription.status = SubscriptionStatus.Cancelled;
    subscription.cancelAtPeriodEnd = false;
    subscription.graceUntil = null;
    subscription.metadata = {
      ...subscription.metadata,
      refundRevocation: {
        refundId,
        paymentId: payment.id,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      },
    };
    await subscriptions.save(subscription);

    const licenses = manager.getRepository(BillingLicenseEntity);
    const license = await licenses.findOne({
      where: { subscriptionId: subscription.id },
    });
    if (license) {
      const previousLicenseStatus = license.status;
      license.status = LicenseStatus.Revoked;
      license.validUntil = refundedAt;
      await licenses.save(license);
      if (previousLicenseStatus !== LicenseStatus.Revoked) {
        await this.audit.record({
          manager,
          organizationId: subscription.organizationId,
          action: 'billing.license.status_changed',
          resourceType: 'billing_license',
          resourceId: license.id,
          provider: BillingProvider.Paypal,
          metadata: {
            paymentId: payment.id,
            refundId: refund.id,
            subscriptionId: subscription.id,
            licenseId: license.id,
            previousStatus: previousLicenseStatus,
            newStatus: LicenseStatus.Revoked,
            outcome: 'full_refund_current_period',
          },
        });
      }
    }

    await this.enqueueCancellation(
      manager,
      subscription.organizationId,
      subscription.providerSubscriptionId,
      'subscription',
      subscription.id,
      null,
      refund.id,
    );

    const addons = manager.getRepository(BillingSubscriptionAddonEntity);
    const activeAddons = await addons.find({
      where: {
        subscriptionId: subscription.id,
        provider: BillingProvider.Paypal,
        status: In([
          SubscriptionAddonStatus.Active,
          SubscriptionAddonStatus.ScheduledCancel,
        ]),
      },
    });
    for (const addon of activeAddons) {
      const previousAddonStatus = addon.status;
      addon.status = SubscriptionAddonStatus.Cancelled;
      await addons.save(addon);
      await this.enqueueCancellation(
        manager,
        subscription.organizationId,
        addon.providerSubscriptionId,
        'addon',
        subscription.id,
        addon.id,
        refund.id,
      );
      await this.audit.record({
        manager,
        organizationId: subscription.organizationId,
        action: 'billing.subscription_addon.cancelled',
        resourceType: 'billing_subscription_addon',
        resourceId: addon.id,
        provider: BillingProvider.Paypal,
        metadata: {
          subscriptionId: subscription.id,
          subscriptionAddonId: addon.id,
          refundId: refund.id,
          previousStatus: previousAddonStatus,
          newStatus: addon.status,
          outcome: 'full_refund_current_period',
        },
      });
    }

    await this.audit.record({
      manager,
      organizationId: subscription.organizationId,
      action: 'billing.subscription.refund_revoked',
      resourceType: 'billing_subscription',
      resourceId: subscription.id,
      provider: BillingProvider.Paypal,
      metadata: {
        paymentId: payment.id,
        refundId: refund.id,
        subscriptionId: subscription.id,
        previousStatus: payment.subscription.status,
        newStatus: subscription.status,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        outcome: 'full_refund_current_period',
      },
    });

    return { processingStatus: WebhookProcessingStatus.Processed };
  }

  async reverseCapture(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
  ): Promise<BillingWebhookProcessorResult> {
    const captureId = this.stringOrNull(input.resource.id);
    if (!captureId) return this.failed('Invalid PayPal capture reference');
    const payments = manager.getRepository(BillingPaymentEntity);
    let payment = await payments.findOne({
      where: { provider: BillingProvider.Paypal, providerCaptureId: captureId },
    });
    if (!payment) return this.failed('Payment not found');
    if (payment.metadata?.operation !== 'plan_change_proration')
      return { processingStatus: WebhookProcessingStatus.Ignored };
    const subscription = await manager
      .getRepository(BillingSubscriptionEntity)
      .findOne({
        where: { id: payment.subscriptionId! },
        lock: { mode: 'pessimistic_write' },
      });
    if (!subscription) return this.failed('Subscription not found');
    await manager.query('SELECT id FROM payments WHERE id=$1 FOR UPDATE', [
      payment.id,
    ]);
    payment = await payments.findOne({ where: { id: payment.id } });
    if (!payment) return this.failed('Payment not found');
    if (
      payment.status === PaymentStatus.Reversed ||
      payment.status === PaymentStatus.Refunded
    )
      return { processingStatus: WebhookProcessingStatus.Processed };
    payment.status = PaymentStatus.Reversed;
    await payments.save(payment);
    await this.restoreProration(
      manager,
      subscription,
      payment,
      new Date(),
      input.providerEventId,
    );
    await this.audit.record({
      manager,
      organizationId: payment.organizationId,
      action: 'billing.payment.status_changed',
      resourceType: 'billing_payment',
      resourceId: payment.id,
      provider: BillingProvider.Paypal,
      metadata: {
        newStatus: PaymentStatus.Reversed,
        providerEventId: input.providerEventId,
      },
    });
    return { processingStatus: WebhookProcessingStatus.Processed };
  }

  private captureId(resource: Record<string, unknown>): string | null {
    const related = this.asRecord(
      this.asRecord(resource.supplementary_data)?.related_ids,
    );
    const direct =
      this.stringOrNull(related?.capture_id) ??
      this.stringOrNull(resource.capture_id);
    if (direct) return direct;
    if (!Array.isArray(resource.links)) return null;
    for (const entry of resource.links) {
      const link = this.asRecord(entry);
      if (link?.rel !== 'up' || typeof link.href !== 'string') continue;
      try {
        const url = new URL(link.href);
        if (
          url.protocol !== 'https:' ||
          ![
            'api.paypal.com',
            'api-m.paypal.com',
            'api.sandbox.paypal.com',
            'api-m.sandbox.paypal.com',
          ].includes(url.hostname)
        )
          continue;
        const match = /^\/v2\/payments\/captures\/([A-Za-z0-9-]+)$/.exec(
          url.pathname,
        );
        if (match) return match[1];
      } catch {
        /* Invalid provider links cannot identify a capture. */
      }
    }
    return null;
  }

  private async restoreProration(
    manager: EntityManager,
    subscription: BillingSubscriptionEntity,
    payment: BillingPaymentEntity,
    refundedAt: Date,
    refundId: string,
  ): Promise<void> {
    if (!payment.periodEnd || payment.periodEnd <= new Date()) return;
    const change = pendingPlanChange(subscription);
    // A later paid change must never be undone by an older capture refund.
    if (
      !change ||
      change.checkoutId !== payment.metadata.checkoutId ||
      change.proration?.refundedAt
    )
      return;
    const previous = this.asRecord(payment.metadata.previousPlan);
    if (
      !previous ||
      typeof previous.planId !== 'string' ||
      typeof previous.planCode !== 'string'
    )
      throw new Error('Proration refund is missing the previous contract');
    const plan = await manager.getRepository(BillingPlanEntity).findOne({
      where: { id: previous.planId },
      relations: {
        versions: {
          prices: { providerPrices: true },
          entitlements: { feature: true },
        },
      },
    });
    if (!plan || !this.licenseCalculator)
      throw new Error('Proration refund contract cannot be restored');
    const price = plan.versions
      ?.flatMap((version) => version.prices ?? [])
      .find((item) => item.id === previous.planPriceId);
    const providerPrice = price?.providerPrices?.find(
      (item) => item.id === previous.providerPriceId,
    );
    if (!price || !providerPrice)
      throw new Error('Proration refund price cannot be restored');
    Object.assign(subscription, {
      planId: plan.id,
      plan,
      planCode: previous.planCode,
      planPriceId: price.id,
      planPrice: price,
      planPriceCode: previous.planPriceCode,
      providerPriceId: providerPrice.id,
      providerPrice,
      legalAcceptanceId: previous.legalAcceptanceId ?? null,
      acceptedAt:
        typeof previous.acceptedAt === 'string'
          ? new Date(previous.acceptedAt)
          : null,
      legalSnapshotHash: previous.legalSnapshotHash ?? null,
    });
    change.proration = {
      ...change.proration,
      refundedAt: refundedAt.toISOString(),
    };
    change.state =
      subscription.cancelAtPeriodEnd || cancellationIntent(subscription)
        ? 'failed'
        : 'scheduled';
    change.effectiveAt = payment.periodEnd.toISOString();
    subscription.metadata = {
      ...subscription.metadata,
      legalEvidence: previous.legalEvidence ?? null,
      pendingPlanChange: change,
    };
    await manager.getRepository(BillingSubscriptionEntity).save(subscription);
    const licenses = manager.getRepository(BillingLicenseEntity);
    const license = await licenses.findOne({
      where: { subscriptionId: subscription.id },
    });
    if (license && license.status === LicenseStatus.Active) {
      const product = await manager
        .getRepository(BillingProductEntity)
        .findOne({ where: { code: subscription.productCode } });
      if (!product) throw new Error('Proration refund product not found');
      Object.assign(
        license,
        this.licenseCalculator.calculate({
          license,
          product,
          subscription,
          status: LicenseStatus.Active,
        }),
      );
      await licenses.save(license);
    }
    await this.audit.record({
      manager,
      organizationId: subscription.organizationId,
      action: 'billing.subscription.proration_refunded',
      resourceType: 'billing_subscription',
      resourceId: subscription.id,
      provider: BillingProvider.Paypal,
      metadata: {
        paymentId: payment.id,
        refundId,
        restoredPlanCode: subscription.planCode,
      },
    });
  }

  private async enqueueCancellation(
    manager: EntityManager,
    organizationId: string,
    providerSubscriptionId: string | null,
    targetType: 'subscription' | 'addon',
    subscriptionId: string,
    addonId: string | null,
    refundId: string,
  ): Promise<void> {
    if (!providerSubscriptionId) return;
    await manager.query(
      'INSERT INTO paypal_cancellation_jobs(organization_id,provider_subscription_id,target_type,target_subscription_id,target_addon_id,source_payment_refund_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider_subscription_id) DO NOTHING',
      [
        organizationId,
        providerSubscriptionId,
        targetType,
        subscriptionId,
        addonId,
        refundId,
      ],
    );
  }

  private moneyCents(value: unknown): number | null {
    if (
      typeof value !== 'string' ||
      !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)
    ) {
      return null;
    }
    const [whole, fraction = ''] = value.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(cents) ? cents : null;
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private dateOrNull(value: unknown): Date | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private failed(note: string): BillingWebhookProcessorResult {
    return { processingStatus: WebhookProcessingStatus.Failed, note };
  }
}
