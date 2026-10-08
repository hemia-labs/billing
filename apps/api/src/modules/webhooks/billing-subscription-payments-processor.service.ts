import { BadGatewayException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BillingAuditService } from '../audit';
import {
  DEFAULT_BILLING_CURRENCY,
  type BillingCurrency,
} from '../billing-shared';
import {
  BillingLicenseEntity,
  BillingPaymentEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import {
  BillingProvider,
  LicenseStatus,
  PaymentStatus,
  SubscriptionStatus,
  WebhookProcessingStatus,
} from '../billing-shared';
import { BillingLicenseCalculatorService } from '../licenses';
import { PaypalClientService } from '../paypal';
import { BillingSubscriptionAddonPaymentsProcessorService } from '../subscription-addons';
import { BillingPaypalRefundsService } from './billing-paypal-refunds.service';
import {
  BillingWebhookProcessorInput,
  BillingWebhookProcessorContext,
  BillingWebhookProcessorResult,
  PaypalEventResource,
} from './types';

const GRACE_DAYS = 7;

const SUPPORTED_EVENTS = new Set([
  'BILLING.SUBSCRIPTION.CREATED',
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'PAYMENT.SALE.COMPLETED',
  'PAYMENT.SALE.REFUNDED',
  'PAYMENT.SALE.REVERSED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
]);

@Injectable()
export class BillingSubscriptionPaymentsProcessorService {
  constructor(
    private readonly paypal: PaypalClientService,
    private readonly licenseCalculator: BillingLicenseCalculatorService,
    private readonly audit: BillingAuditService,
    private readonly addonProcessor?: BillingSubscriptionAddonPaymentsProcessorService,
    private readonly refunds?: BillingPaypalRefundsService,
  ) {}

  async process(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    context: BillingWebhookProcessorContext = {},
  ): Promise<BillingWebhookProcessorResult> {
    const addonResult = await this.addonProcessor?.process(manager, input);
    if (addonResult) return addonResult;
    if (!SUPPORTED_EVENTS.has(input.eventType)) {
      return { processingStatus: WebhookProcessingStatus.Ignored };
    }

    switch (input.eventType) {
      case 'BILLING.SUBSCRIPTION.CREATED':
        return this.processSubscriptionStatus(manager, input, context);
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        return this.processSubscriptionAndLicenseStatus(
          manager,
          input,
          context,
        );
      case 'PAYMENT.SALE.COMPLETED':
        return this.processPaymentCompleted(manager, input, context);
      case 'PAYMENT.SALE.REFUNDED':
        return (
          this.refunds?.process(manager, input) ??
          this.retryableFailure('PayPal refund processor unavailable')
        );
      case 'PAYMENT.SALE.REVERSED':
        return this.processPaymentReversed(manager, input);
      default:
        return { processingStatus: WebhookProcessingStatus.Ignored };
    }
  }

  async prepare(
    input: BillingWebhookProcessorInput,
  ): Promise<BillingWebhookProcessorContext> {
    if (
      ![
        'BILLING.SUBSCRIPTION.CREATED',
        'BILLING.SUBSCRIPTION.ACTIVATED',
        'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
        'BILLING.SUBSCRIPTION.SUSPENDED',
        'BILLING.SUBSCRIPTION.CANCELLED',
        'BILLING.SUBSCRIPTION.EXPIRED',
        'PAYMENT.SALE.COMPLETED',
      ].includes(input.eventType)
    ) {
      return {};
    }

    const providerSubscriptionId = this.extractSubscriptionId(
      input.resource,
      input.eventType !== 'PAYMENT.SALE.COMPLETED',
    );
    if (!providerSubscriptionId) return {};

    return {
      paypalSubscription: await this.paypal.getSubscription(
        providerSubscriptionId,
      ),
    };
  }

  private async processSubscriptionStatus(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    context: BillingWebhookProcessorContext,
  ): Promise<BillingWebhookProcessorResult> {
    const subscription = await this.updateSubscriptionFromPaypal(
      manager,
      input,
      true,
      context,
    );

    return subscription
      ? { processingStatus: WebhookProcessingStatus.Processed }
      : this.retryableFailure('Subscription not found');
  }

  private async processSubscriptionAndLicenseStatus(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    context: BillingWebhookProcessorContext,
  ): Promise<BillingWebhookProcessorResult> {
    const subscription = await this.updateSubscriptionFromPaypal(
      manager,
      input,
      true,
      context,
    );

    if (!subscription) return this.retryableFailure('Subscription not found');

    await this.upsertLicense(manager, input, subscription);
    return { processingStatus: WebhookProcessingStatus.Processed };
  }

  private async processPaymentCompleted(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    context: BillingWebhookProcessorContext,
  ): Promise<BillingWebhookProcessorResult> {
    const subscription = await this.updateSubscriptionFromPaypal(
      manager,
      input,
      false,
      context,
    );
    if (!subscription)
      return this.retryableFailure('Payment subscription not found');

    await this.upsertPayment(manager, input, PaymentStatus.Paid, subscription);

    await this.upsertLicense(manager, input, subscription);
    return { processingStatus: WebhookProcessingStatus.Processed };
  }

  private async processPaymentReversed(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
  ): Promise<BillingWebhookProcessorResult> {
    const result = await this.processPaymentStatus(
      manager,
      input,
      PaymentStatus.Reversed,
    );
    if (result.processingStatus !== WebhookProcessingStatus.Processed)
      return result;
    const subscription = await this.findSubscriptionForPayment(
      manager,
      input.resource,
    );

    if (subscription) {
      const previousStatus = subscription.status;
      subscription.status = SubscriptionStatus.PastDue;
      subscription.graceUntil = this.addDays(new Date(), GRACE_DAYS);
      await manager.getRepository(BillingSubscriptionEntity).save(subscription);
      await this.audit.record({
        manager,
        organizationId: subscription.organizationId,
        action: 'billing.subscription.status_changed',
        resourceType: 'billing_subscription',
        resourceId: subscription.id,
        provider: BillingProvider.Paypal,
        legalReference: this.toLegalReference(subscription),
        metadata: this.toAuditMetadata(input, {
          subscriptionId: subscription.id,
          previousStatus,
          newStatus: SubscriptionStatus.PastDue,
        }),
      });
      await this.upsertLicense(manager, input, subscription);
    }

    return result;
  }

  private async processPaymentStatus(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    status: PaymentStatus,
  ): Promise<BillingWebhookProcessorResult> {
    const payment = await this.findPayment(manager, input.resource);

    if (!payment) return this.retryableFailure('Payment not found');

    const previousStatus = payment.status;
    payment.status = status;
    payment.metadata = {
      ...payment.metadata,
      paypalStatusEvent: input.resource,
    };
    await manager.getRepository(BillingPaymentEntity).save(payment);

    if (previousStatus !== status) {
      await this.audit.record({
        manager,
        organizationId: payment.organizationId,
        action: 'billing.payment.status_changed',
        resourceType: 'billing_payment',
        resourceId: payment.id,
        provider: BillingProvider.Paypal,
        legalReference: payment.subscription
          ? this.toLegalReference(payment.subscription)
          : null,
        metadata: this.toAuditMetadata(input, {
          paymentId: payment.id,
          previousStatus,
          newStatus: status,
        }),
      });
    }

    return { processingStatus: WebhookProcessingStatus.Processed };
  }

  private async updateSubscriptionFromPaypal(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    includeResourceId = true,
    context: BillingWebhookProcessorContext = {},
  ): Promise<BillingSubscriptionEntity | null> {
    const providerSubscriptionId = this.extractSubscriptionId(
      input.resource,
      includeResourceId,
    );
    if (!providerSubscriptionId) return null;

    const subscriptions = manager.getRepository(BillingSubscriptionEntity);
    const subscription = await subscriptions.findOne({
      where: { provider: BillingProvider.Paypal, providerSubscriptionId },
      relations: {
        plan: {
          versions: {
            prices: { providerPrices: true },
            entitlements: { feature: true },
          },
        },
      },
    });

    if (!subscription) return null;

    const paypalSubscription =
      context.paypalSubscription ??
      (await this.paypal.getSubscription(providerSubscriptionId));
    const paypalRaw = paypalSubscription.raw;
    const billingInfo = this.asRecord(paypalRaw.billing_info);
    const previousStatus = subscription.status;
    const newStatus = subscription.metadata.refundRevocation
      ? SubscriptionStatus.Cancelled
      : this.mapPaypalSubscriptionStatus(
          paypalSubscription.status ?? this.stringOrNull(paypalRaw.status),
          billingInfo,
        );
    const nextBillingTime = this.dateOrNull(billingInfo?.next_billing_time);
    if (
      input.eventType === 'PAYMENT.SALE.COMPLETED' &&
      newStatus === SubscriptionStatus.Active &&
      !nextBillingTime
    ) {
      throw new BadGatewayException('PayPal next billing time is unavailable');
    }

    const paidThrough =
      subscription.currentPeriodEnd ?? subscription.nextBillingTime;
    subscription.status = newStatus;
    subscription.nextBillingTime = subscription.metadata.refundRevocation
      ? null
      : nextBillingTime;
    subscription.currentPeriodStart = this.dateOrNull(
      this.getNested(billingInfo, 'last_payment', 'time'),
    );
    subscription.currentPeriodEnd =
      nextBillingTime ??
      (newStatus === SubscriptionStatus.Cancelled &&
      subscription.cancelAtPeriodEnd
        ? paidThrough
        : null);
    subscription.graceUntil =
      newStatus === SubscriptionStatus.PastDue
        ? (subscription.graceUntil ?? this.addDays(new Date(), GRACE_DAYS))
        : newStatus === SubscriptionStatus.Active
          ? null
          : subscription.graceUntil;
    subscription.metadata = {
      ...subscription.metadata,
      paypalStatus:
        paypalSubscription.status ?? this.stringOrNull(paypalRaw.status),
      paypalBillingInfo: billingInfo ?? null,
    };

    const saved = await subscriptions.save(subscription);

    if (previousStatus !== saved.status) {
      await this.audit.record({
        manager,
        organizationId: saved.organizationId,
        action: 'billing.subscription.status_changed',
        resourceType: 'billing_subscription',
        resourceId: saved.id,
        provider: BillingProvider.Paypal,
        legalReference: this.toLegalReference(saved),
        metadata: this.toAuditMetadata(input, {
          subscriptionId: saved.id,
          previousStatus,
          newStatus: saved.status,
        }),
      });
    }

    return saved;
  }

  private async upsertLicense(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    subscription: BillingSubscriptionEntity,
  ): Promise<void> {
    const status = subscription.metadata.refundRevocation
      ? LicenseStatus.Revoked
      : subscription.status === SubscriptionStatus.Active
        ? LicenseStatus.Active
        : subscription.status === SubscriptionStatus.PastDue
          ? LicenseStatus.Grace
          : subscription.status === SubscriptionStatus.Suspended
            ? LicenseStatus.Suspended
            : LicenseStatus.Revoked;
    const licenses = manager.getRepository(BillingLicenseEntity);
    const products = manager.getRepository(BillingProductEntity);
    const product = await products.findOne({
      where: { code: subscription.productCode },
    });

    if (!product) return;

    const existing = await licenses.findOne({
      where: { subscriptionId: subscription.id },
    });
    const previousStatus = existing?.status ?? null;
    const calculation = this.licenseCalculator.calculate({
      license: existing,
      product,
      subscription,
      status,
    });
    const license =
      existing ??
      licenses.create({
        organizationId: calculation.organizationId,
        productId: calculation.productId,
        productCode: calculation.productCode,
        subscriptionId: calculation.subscriptionId,
        planCode: calculation.planCode,
        licenseKeyHash: calculation.licenseKeyHash,
      });

    license.status = calculation.status;
    license.seatsLimit = calculation.seatsLimit;
    license.usageLimit = calculation.usageLimit;
    license.featuresJson = calculation.featuresJson;
    license.validUntil = calculation.validUntil;
    const saved = await licenses.save(license);

    if (previousStatus !== calculation.status) {
      await this.audit.record({
        manager,
        organizationId: subscription.organizationId,
        action: 'billing.license.status_changed',
        resourceType: 'billing_license',
        resourceId: saved.id,
        provider: BillingProvider.Paypal,
        legalReference: this.toLegalReference(subscription),
        metadata: this.toAuditMetadata(input, {
          subscriptionId: subscription.id,
          licenseId: saved.id,
          previousStatus,
          newStatus: calculation.status,
        }),
      });
    }
  }

  private async upsertPayment(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    status: PaymentStatus,
    subscription: BillingSubscriptionEntity,
  ): Promise<BillingPaymentEntity> {
    const payments = manager.getRepository(BillingPaymentEntity);
    const existing = await this.findPayment(manager, input.resource);
    const amount = this.extractAmount(input.resource);
    const previousStatus = existing?.status ?? null;
    const payment =
      existing ??
      payments.create({
        organizationId: subscription.organizationId,
        subscriptionId: subscription.id,
        subscription,
        provider: BillingProvider.Paypal,
        rawEventId: input.eventId,
        metadata: {},
      });

    if (existing?.status === PaymentStatus.Refunded) return existing;

    payment.providerPaymentId = this.extractProviderPaymentId(input.resource);
    payment.providerCaptureId = this.extractPaymentCaptureId(input.resource);
    payment.amount = amount.total;
    payment.currency = amount.currency;
    payment.status = status;
    payment.paidAt = this.dateOrNull(input.resource.create_time) ?? new Date();
    payment.periodStart = subscription.currentPeriodStart ?? payment.paidAt;
    payment.periodEnd =
      subscription.currentPeriodEnd ?? subscription.nextBillingTime;
    payment.rawEventId = input.eventId;
    payment.metadata = {
      ...payment.metadata,
      paypalResource: input.resource,
    };

    const saved = await payments.save(payment);

    if (previousStatus !== status) {
      await this.audit.record({
        manager,
        organizationId: subscription.organizationId,
        action: previousStatus
          ? 'billing.payment.status_changed'
          : 'billing.payment.created',
        resourceType: 'billing_payment',
        resourceId: saved.id,
        provider: BillingProvider.Paypal,
        legalReference: this.toLegalReference(subscription),
        metadata: this.toAuditMetadata(input, {
          subscriptionId: subscription.id,
          paymentId: saved.id,
          previousStatus,
          newStatus: status,
        }),
      });
    }

    return saved;
  }

  private async findPayment(
    manager: EntityManager,
    resource: PaypalEventResource,
  ): Promise<BillingPaymentEntity | null> {
    const payments = manager.getRepository(BillingPaymentEntity);
    const providerCaptureId =
      typeof resource.sale_id === 'string'
        ? this.stringOrNull(resource.sale_id)
        : this.extractPaymentCaptureId(resource);
    const providerPaymentId = this.extractProviderPaymentId(resource);

    return (
      (providerCaptureId
        ? await payments.findOne({
            where: { provider: BillingProvider.Paypal, providerCaptureId },
            relations: { subscription: true },
          })
        : null) ??
      (providerPaymentId
        ? await payments.findOne({
            where: { provider: BillingProvider.Paypal, providerPaymentId },
            relations: { subscription: true },
          })
        : null)
    );
  }

  private async findSubscriptionForPayment(
    manager: EntityManager,
    resource: PaypalEventResource,
  ): Promise<BillingSubscriptionEntity | null> {
    const providerSubscriptionId = this.extractSubscriptionId(resource, false);
    if (!providerSubscriptionId) return null;

    return manager.getRepository(BillingSubscriptionEntity).findOne({
      where: { provider: BillingProvider.Paypal, providerSubscriptionId },
      relations: {
        plan: {
          versions: {
            prices: { providerPrices: true },
            entitlements: { feature: true },
          },
        },
      },
    });
  }

  private mapPaypalSubscriptionStatus(
    paypalStatus: string | null | undefined,
    billingInfo?: Record<string, unknown>,
  ): SubscriptionStatus {
    const failedPayments = this.numberOrNull(
      billingInfo?.failed_payments_count,
    );

    switch (paypalStatus) {
      case 'ACTIVE':
        if (failedPayments && failedPayments >= 3) {
          return SubscriptionStatus.Suspended;
        }
        return failedPayments
          ? SubscriptionStatus.PastDue
          : SubscriptionStatus.Active;
      case 'SUSPENDED':
        return SubscriptionStatus.Suspended;
      case 'CANCELLED':
        return SubscriptionStatus.Cancelled;
      case 'EXPIRED':
        return SubscriptionStatus.Expired;
      case 'APPROVAL_PENDING':
      case 'APPROVED':
        return SubscriptionStatus.Pending;
      default:
        throw new BadGatewayException(
          'PayPal subscription status is unavailable',
        );
    }
  }

  private retryableFailure(note: string): BillingWebhookProcessorResult {
    return { processingStatus: WebhookProcessingStatus.Failed, note };
  }

  private extractSubscriptionId(
    resource: PaypalEventResource,
    includeResourceId = true,
  ): string | null {
    return (
      (includeResourceId ? this.stringOrNull(resource.id) : null) ??
      this.stringOrNull(resource.billing_agreement_id) ??
      this.stringOrNull(resource.subscription_id) ??
      this.stringOrNull(
        this.getNested(
          resource,
          'supplementary_data',
          'related_ids',
          'subscription_id',
        ),
      )
    );
  }

  private extractPaymentCaptureId(
    resource: PaypalEventResource,
  ): string | null {
    return (
      this.stringOrNull(resource.id) ??
      this.stringOrNull(resource.sale_id) ??
      this.stringOrNull(
        this.getNested(
          resource,
          'supplementary_data',
          'related_ids',
          'sale_id',
        ),
      )
    );
  }

  private extractProviderPaymentId(
    resource: PaypalEventResource,
  ): string | null {
    return (
      this.stringOrNull(resource.parent_payment) ??
      this.stringOrNull(resource.parent_payment_id) ??
      this.stringOrNull(
        this.getNested(
          resource,
          'supplementary_data',
          'related_ids',
          'payment_id',
        ),
      )
    );
  }

  private extractAmount(resource: PaypalEventResource): {
    total: string;
    currency: BillingCurrency;
  } {
    const amount = this.asRecord(resource.amount);
    const total =
      this.stringOrNull(amount?.total) ??
      this.stringOrNull(amount?.value) ??
      this.stringOrNull(resource.total) ??
      '0.00';
    const currency =
      this.stringOrNull(amount?.currency) ??
      this.stringOrNull(amount?.currency_code) ??
      DEFAULT_BILLING_CURRENCY;

    return { total, currency: currency as BillingCurrency };
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

  private getNested(value: unknown, ...path: Array<string | number>): unknown {
    return path.reduce<unknown>((current, key) => {
      if (typeof key === 'number') {
        return Array.isArray(current) ? current[key] : undefined;
      }

      return this.asRecord(current)?.[key];
    }, value);
  }

  private toLegalReference(subscription: BillingSubscriptionEntity) {
    return {
      legalAcceptanceId: subscription.legalAcceptanceId,
      evidence: Array.isArray(subscription.metadata?.legalEvidence)
        ? subscription.metadata.legalEvidence
        : undefined,
      acceptedAt: subscription.acceptedAt,
      legalSnapshotHash: subscription.legalSnapshotHash,
    };
  }

  private toAuditMetadata(
    input: BillingWebhookProcessorInput,
    metadata: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...metadata,
      webhookEventId: input.eventId,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
    };
  }
}
