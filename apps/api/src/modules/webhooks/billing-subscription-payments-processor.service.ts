import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BillingAuditService } from '../audit';
import { DEFAULT_BILLING_CURRENCY, type BillingCurrency } from '../billing-shared';
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
import {
  BillingWebhookProcessorInput,
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
  ) {}

  async process(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
  ): Promise<BillingWebhookProcessorResult> {
    if (!SUPPORTED_EVENTS.has(input.eventType)) {
      return { processingStatus: WebhookProcessingStatus.Ignored };
    }

    switch (input.eventType) {
      case 'BILLING.SUBSCRIPTION.CREATED':
        return this.processSubscriptionStatus(manager, input, SubscriptionStatus.Pending);
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        return this.processActivatedSubscription(manager, input);
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
        return this.processPaymentFailed(manager, input);
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        return this.processSubscriptionAndLicenseStatus(
          manager,
          input,
          SubscriptionStatus.Suspended,
          LicenseStatus.Suspended,
        );
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        return this.processSubscriptionAndLicenseStatus(
          manager,
          input,
          SubscriptionStatus.Cancelled,
          LicenseStatus.Revoked,
        );
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        return this.processSubscriptionAndLicenseStatus(
          manager,
          input,
          SubscriptionStatus.Expired,
          LicenseStatus.Revoked,
        );
      case 'PAYMENT.SALE.COMPLETED':
        return this.processPaymentCompleted(manager, input);
      case 'PAYMENT.SALE.REFUNDED':
        return this.processPaymentStatus(manager, input, PaymentStatus.Refunded);
      case 'PAYMENT.SALE.REVERSED':
        return this.processPaymentReversed(manager, input);
      default:
        return { processingStatus: WebhookProcessingStatus.Ignored };
    }
  }

  private async processActivatedSubscription(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
  ): Promise<BillingWebhookProcessorResult> {
    const subscription = await this.updateSubscriptionFromPaypal(
      manager,
      input,
      SubscriptionStatus.Active,
      true,
    );

    if (!subscription) return this.ignored('Subscription not found');

    await this.upsertLicense(manager, input, subscription, LicenseStatus.Active);
    return { processingStatus: WebhookProcessingStatus.Processed };
  }

  private async processPaymentFailed(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
  ): Promise<BillingWebhookProcessorResult> {
    const subscription = await this.updateSubscriptionFromPaypal(
      manager,
      input,
      SubscriptionStatus.PastDue,
      true,
    );

    if (!subscription) return this.ignored('Subscription not found');

    const failureCount = this.numberOrNull(
      this.getNested(subscription.metadata, 'paypalBillingInfo', 'failed_payments_count'),
    );
    const licenseStatus =
      failureCount && failureCount >= 3 ? LicenseStatus.Suspended : LicenseStatus.Grace;
    const subscriptionStatus =
      licenseStatus === LicenseStatus.Suspended
        ? SubscriptionStatus.Suspended
        : SubscriptionStatus.PastDue;

    if (subscription.status !== subscriptionStatus) {
      const previousStatus = subscription.status;
      subscription.status = subscriptionStatus;
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
          newStatus: subscriptionStatus,
        }),
      });
    }

    await this.upsertLicense(manager, input, subscription, licenseStatus);
    return { processingStatus: WebhookProcessingStatus.Processed };
  }

  private async processSubscriptionStatus(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    status: SubscriptionStatus,
  ): Promise<BillingWebhookProcessorResult> {
    const subscription = await this.updateSubscriptionFromPaypal(
      manager,
      input,
      status,
      true,
    );

    return subscription
      ? { processingStatus: WebhookProcessingStatus.Processed }
      : this.ignored('Subscription not found');
  }

  private async processSubscriptionAndLicenseStatus(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    subscriptionStatus: SubscriptionStatus,
    licenseStatus: LicenseStatus,
  ): Promise<BillingWebhookProcessorResult> {
    const subscription = await this.updateSubscriptionFromPaypal(
      manager,
      input,
      subscriptionStatus,
      true,
    );

    if (!subscription) return this.ignored('Subscription not found');

    await this.upsertLicense(manager, input, subscription, licenseStatus);
    return { processingStatus: WebhookProcessingStatus.Processed };
  }

  private async processPaymentCompleted(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
  ): Promise<BillingWebhookProcessorResult> {
    const subscription = await this.findSubscriptionForPayment(manager, input.resource);
    if (!subscription) return this.ignored('Payment subscription not found');

    await this.upsertPayment(manager, input, PaymentStatus.Paid, subscription);

    if (
      subscription.status === SubscriptionStatus.PastDue ||
      subscription.graceUntil
    ) {
      const previousStatus = subscription.status;
      subscription.status = SubscriptionStatus.Active;
      subscription.graceUntil = null;
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
          newStatus: SubscriptionStatus.Active,
        }),
      });
    }

    await this.upsertLicense(manager, input, subscription, LicenseStatus.Active);
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
    const subscription = await this.findSubscriptionForPayment(manager, input.resource);

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
      await this.upsertLicense(manager, input, subscription, LicenseStatus.Grace);
    }

    return result;
  }

  private async processPaymentStatus(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
    status: PaymentStatus,
  ): Promise<BillingWebhookProcessorResult> {
    const payment = await this.findPayment(manager, input.resource);

    if (!payment) return this.ignored('Payment not found');

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
    fallbackStatus: SubscriptionStatus,
    confirmWithPaypal: boolean,
  ): Promise<BillingSubscriptionEntity | null> {
    const providerSubscriptionId = this.extractSubscriptionId(input.resource);
    if (!providerSubscriptionId) return null;

    const subscriptions = manager.getRepository(BillingSubscriptionEntity);
    const subscription = await subscriptions.findOne({
      where: { provider: BillingProvider.Paypal, providerSubscriptionId },
      relations: { plan: true },
    });

    if (!subscription) return null;

    const paypalSubscription = confirmWithPaypal
      ? await this.paypal.getSubscription(providerSubscriptionId)
      : null;
    const paypalRaw = paypalSubscription?.raw ?? input.resource;
    const billingInfo = this.asRecord(paypalRaw.billing_info);
    const previousStatus = subscription.status;
    const newStatus = this.mapPaypalSubscriptionStatus(
      paypalSubscription?.status ?? this.stringOrNull(paypalRaw.status),
      fallbackStatus,
      billingInfo,
    );

    subscription.status = newStatus;
    subscription.nextBillingTime = this.dateOrNull(
      billingInfo?.next_billing_time,
    );
    subscription.currentPeriodStart = this.dateOrNull(
      this.getNested(billingInfo, 'cycle_executions', 0, 'start_time'),
    );
    subscription.currentPeriodEnd = this.dateOrNull(
      this.getNested(billingInfo, 'cycle_executions', 0, 'end_time'),
    );
    subscription.graceUntil =
      newStatus === SubscriptionStatus.PastDue
        ? this.addDays(new Date(), GRACE_DAYS)
        : newStatus === SubscriptionStatus.Active
          ? null
          : subscription.graceUntil;
    subscription.metadata = {
      ...subscription.metadata,
      paypalStatus: paypalSubscription?.status ?? this.stringOrNull(paypalRaw.status),
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
    status: LicenseStatus,
  ): Promise<void> {
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

    if (previousStatus !== status) {
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
          newStatus: status,
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

    payment.providerPaymentId = this.extractProviderPaymentId(input.resource);
    payment.providerCaptureId = this.extractPaymentCaptureId(input.resource);
    payment.amount = amount.total;
    payment.currency = amount.currency;
    payment.status = status;
    payment.paidAt = this.dateOrNull(input.resource.create_time) ?? new Date();
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
    const providerCaptureId = this.extractPaymentCaptureId(resource);
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
      relations: { plan: true },
    });
  }

  private mapPaypalSubscriptionStatus(
    paypalStatus: string | null | undefined,
    fallback: SubscriptionStatus,
    billingInfo?: Record<string, unknown>,
  ): SubscriptionStatus {
    const failedPayments = this.numberOrNull(billingInfo?.failed_payments_count);

    if (failedPayments && failedPayments >= 3) {
      return SubscriptionStatus.Suspended;
    }

    switch (paypalStatus) {
      case 'ACTIVE':
        return failedPayments ? SubscriptionStatus.PastDue : SubscriptionStatus.Active;
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
        return fallback;
    }
  }

  private ignored(note: string): BillingWebhookProcessorResult {
    return { processingStatus: WebhookProcessingStatus.Ignored, note };
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

  private extractPaymentCaptureId(resource: PaypalEventResource): string | null {
    return (
      this.stringOrNull(resource.id) ??
      this.stringOrNull(resource.sale_id) ??
      this.stringOrNull(
        this.getNested(resource, 'supplementary_data', 'related_ids', 'sale_id'),
      )
    );
  }

  private extractProviderPaymentId(resource: PaypalEventResource): string | null {
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
      termsVersion: subscription.termsVersion,
      privacyVersion: subscription.privacyVersion,
      refundPolicyVersion: subscription.refundPolicyVersion,
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
