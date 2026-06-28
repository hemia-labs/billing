import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { BillingAuditService } from '../audit';
import { BillingPlanCatalogResolver } from '../catalog';
import { BillingCheckoutService } from '../checkout';
import { BillingEntitlementsService } from '../entitlements';
import {
  BillingCheckoutSessionEntity,
  BillingLicenseEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import {
  BillingCheckoutSessionStatus,
  BillingPlanStatus,
  BillingProvider,
  LicenseStatus,
  SubscriptionStatus,
} from '../billing-shared';
import { BillingLicenseCalculatorService } from '../licenses';
import { PaypalClientService } from '../paypal';
import {
  CancelSubscriptionDto,
  ChangePlanDto,
  ChangePlanResponseDto,
  VerifyCheckoutSessionResponseDto,
} from './dtos';
import { SubscriptionManagementMapper } from './mappers';

const CURRENT_STATUS_PRIORITY = [
  SubscriptionStatus.Active,
  SubscriptionStatus.PastDue,
  SubscriptionStatus.Pending,
];

const TERMINAL_STATUSES = [
  SubscriptionStatus.Cancelled,
  SubscriptionStatus.Expired,
];

@Injectable()
export class BillingSubscriptionsManagementService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly checkout: BillingCheckoutService,
    private readonly entitlements: BillingEntitlementsService,
    private readonly paypal: PaypalClientService,
    private readonly licenseCalculator: BillingLicenseCalculatorService,
    private readonly audit: BillingAuditService,
    private readonly planResolver: BillingPlanCatalogResolver,
    @InjectRepository(BillingSubscriptionEntity)
    private readonly subscriptions: Repository<BillingSubscriptionEntity>,
    @InjectRepository(BillingPlanEntity)
    private readonly plans: Repository<BillingPlanEntity>,
    @InjectRepository(BillingCheckoutSessionEntity)
    private readonly checkoutSessions: Repository<BillingCheckoutSessionEntity>,
  ) {}

  async getCurrentSubscription(
    organizationId: string,
    productCode: string,
  ) {
    const candidates = await this.subscriptions.find({
      where: {
        organizationId,
        productCode,
        status: In(CURRENT_STATUS_PRIORITY),
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
      order: { updatedAt: 'DESC' },
    });

    const subscription = candidates.sort(
      (left, right) =>
        CURRENT_STATUS_PRIORITY.indexOf(left.status) -
          CURRENT_STATUS_PRIORITY.indexOf(right.status) ||
        right.updatedAt.getTime() - left.updatedAt.getTime(),
    )[0];

    if (!subscription) {
      throw new NotFoundException('Current billing subscription not found');
    }

    return this.toResponse(subscription);
  }

  async cancelSubscription(
    subscriptionId: string,
    dto: CancelSubscriptionDto,
  ) {
    const subscription = await this.findSubscription(subscriptionId);
    if (TERMINAL_STATUSES.includes(subscription.status)) {
      throw new BadRequestException('Billing subscription is already terminal');
    }

    if (
      subscription.provider === BillingProvider.Paypal &&
      subscription.providerSubscriptionId
    ) {
      try {
        await this.paypal.cancelSubscription({
          providerSubscriptionId: subscription.providerSubscriptionId,
          reason: dto.reason,
        });
      } catch (error) {
        throw new BadGatewayException('PayPal subscription cancellation failed', {
          cause: error,
        });
      }
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const previousStatus = subscription.status;
      subscription.cancelAtPeriodEnd = true;
      subscription.metadata = {
        ...subscription.metadata,
        cancellation: {
          requestedAt: new Date().toISOString(),
          reason: dto.reason ?? null,
        },
      };

      const savedSubscription = await manager
        .getRepository(BillingSubscriptionEntity)
        .save(subscription);

      await this.audit.record({
        manager,
        organizationId: savedSubscription.organizationId,
        action: 'billing.subscription.cancel_scheduled',
        resourceType: 'billing_subscription',
        resourceId: savedSubscription.id,
        provider: savedSubscription.provider,
        legalReference: this.toLegalReference(savedSubscription),
        metadata: {
          subscriptionId: savedSubscription.id,
          previousStatus,
          newStatus: savedSubscription.status,
          providerSubscriptionId: savedSubscription.providerSubscriptionId,
        },
      });

      return savedSubscription;
    });

    return this.toResponse(saved);
  }

  async changePlan(
    subscriptionId: string,
    dto: ChangePlanDto,
  ): Promise<ChangePlanResponseDto> {
    const subscription = await this.findSubscription(subscriptionId);
    if (TERMINAL_STATUSES.includes(subscription.status)) {
      throw new BadRequestException('Billing subscription is already terminal');
    }

    const targetPlan = await this.findTargetPlan(
      subscription,
      dto.targetPlanCode,
      dto.targetPlanPriceCode,
    );
    const checkout = await this.checkout.createCheckoutSession({
      organizationId: subscription.organizationId,
      userId: dto.actorUserId ?? subscription.organizationId,
      productCode: subscription.productCode,
      planCode: targetPlan.code,
      planPriceCode: dto.targetPlanPriceCode,
      provider: subscription.provider,
      legalAcceptanceId: dto.legalAcceptanceId,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      billingEmail: dto.billingEmail,
    });

    if (
      subscription.provider === BillingProvider.Paypal &&
      subscription.providerSubscriptionId
    ) {
      try {
        await this.paypal.cancelSubscription({
          providerSubscriptionId: subscription.providerSubscriptionId,
          reason: `Plan change requested to ${targetPlan.code}`,
        });
      } catch (error) {
        throw new BadGatewayException('PayPal subscription cancellation failed', {
          cause: error,
        });
      }
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const previousStatus = subscription.status;
      subscription.cancelAtPeriodEnd = true;
      subscription.metadata = {
        ...subscription.metadata,
        pendingPlanChange: {
          checkoutSessionId: checkout.checkoutId,
          targetPlanCode: targetPlan.code,
          targetPlanPriceCode: dto.targetPlanPriceCode,
          newSubscriptionId: checkout.subscriptionId,
          requestedAt: new Date().toISOString(),
        },
      };

      const savedSubscription = await manager
        .getRepository(BillingSubscriptionEntity)
        .save(subscription);

      await this.audit.record({
        manager,
        organizationId: savedSubscription.organizationId,
        actorUserId: dto.actorUserId ?? null,
        action: 'billing.subscription.plan_change_requested',
        resourceType: 'billing_subscription',
        resourceId: savedSubscription.id,
        provider: savedSubscription.provider,
        legalReference: this.toLegalReference(savedSubscription),
        metadata: {
          checkoutSessionId: checkout.checkoutId,
          subscriptionId: savedSubscription.id,
          previousStatus,
          newStatus: savedSubscription.status,
          targetPlanCode: targetPlan.code,
          targetPlanPriceCode: dto.targetPlanPriceCode,
          providerSubscriptionId: savedSubscription.providerSubscriptionId,
        },
      });

      return savedSubscription;
    });

    return {
      subscription: await this.toResponse(saved),
      checkoutId: checkout.checkoutId,
      newSubscriptionId: checkout.subscriptionId,
      checkoutUrl: checkout.checkoutUrl,
      targetPlanCode: targetPlan.code,
    };
  }

  async verifyCheckoutSession(
    checkoutId: string,
    actorUserId?: string,
  ): Promise<VerifyCheckoutSessionResponseDto> {
    const checkoutSession = await this.checkoutSessions.findOne({
      where: { id: checkoutId },
    });
    if (!checkoutSession) {
      throw new NotFoundException('Billing checkout session not found');
    }

    const subscriptionId = this.stringOrNull(
      checkoutSession.metadata?.subscriptionId,
    );
    const subscription = subscriptionId
      ? await this.findSubscription(subscriptionId)
      : null;

    if (!subscription) {
      throw new NotFoundException('Billing subscription not found');
    }
    if (!subscription.providerSubscriptionId) {
      throw new BadRequestException('Provider subscription id is missing');
    }

    const paypalSubscription = await this.paypal.getSubscription(
      subscription.providerSubscriptionId,
    );
    const providerStatus = paypalSubscription.status ?? null;
    const billingInfo = paypalSubscription.billingInfo;
    const newStatus = this.mapPaypalSubscriptionStatus(providerStatus);
    const licenseStatus = this.mapLicenseStatus(newStatus);
    const verifiedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      const previousStatus = subscription.status;
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
        newStatus === SubscriptionStatus.Active ? null : subscription.graceUntil;
      subscription.metadata = {
        ...subscription.metadata,
        paypalStatus: providerStatus,
        paypalProviderPlanId: paypalSubscription.planId ?? null,
        manuallyVerifiedAt: verifiedAt.toISOString(),
      };

      await manager.getRepository(BillingSubscriptionEntity).save(subscription);

      checkoutSession.status = this.mapCheckoutStatus(newStatus);
      await manager.getRepository(BillingCheckoutSessionEntity).save(checkoutSession);

      if (previousStatus !== newStatus) {
        await this.audit.record({
          manager,
          organizationId: subscription.organizationId,
          action: 'billing.subscription.status_changed',
          resourceType: 'billing_subscription',
          resourceId: subscription.id,
          provider: subscription.provider,
          legalReference: this.toLegalReference(subscription),
          metadata: {
            checkoutSessionId: checkoutSession.id,
            subscriptionId: subscription.id,
            previousStatus,
            newStatus,
            providerSubscriptionId: subscription.providerSubscriptionId,
            providerStatus,
          },
        });
      }

      if (licenseStatus) {
        await this.upsertLicense(manager, subscription, licenseStatus);
      }

      await this.audit.record({
        manager,
        organizationId: subscription.organizationId,
        actorUserId: actorUserId ?? checkoutSession.userId,
        action: 'billing.checkout.manual_verified',
        resourceType: 'billing_checkout_session',
        resourceId: checkoutSession.id,
        provider: subscription.provider,
        legalReference: this.toLegalReference(subscription),
        metadata: {
          checkoutSessionId: checkoutSession.id,
          subscriptionId: subscription.id,
          newStatus,
          providerSubscriptionId: subscription.providerSubscriptionId,
          providerStatus,
        },
      });
    });

    return {
      checkoutId: checkoutSession.id,
      subscriptionId: subscription.id,
      provider: checkoutSession.provider,
      providerSubscriptionId: subscription.providerSubscriptionId,
      providerStatus,
      checkoutStatus: checkoutSession.status,
      subscriptionStatus: subscription.status,
      licenseStatus,
      verifiedAt,
    };
  }

  private async upsertLicense(
    manager: EntityManager,
    subscription: BillingSubscriptionEntity,
    status: LicenseStatus,
  ): Promise<void> {
    const product = await manager
      .getRepository(BillingProductEntity)
      .findOne({ where: { code: subscription.productCode } });
    if (!product) return;

    const licenses = manager.getRepository(BillingLicenseEntity);
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
        provider: subscription.provider,
        legalReference: this.toLegalReference(subscription),
        metadata: {
          subscriptionId: subscription.id,
          licenseId: saved.id,
          previousStatus,
          newStatus: status,
          providerSubscriptionId: subscription.providerSubscriptionId,
        },
      });
    }
  }

  private async findSubscription(
    subscriptionId: string,
  ): Promise<BillingSubscriptionEntity> {
    const subscription = await this.subscriptions.findOne({
      where: { id: subscriptionId },
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
    if (!subscription) {
      throw new NotFoundException('Billing subscription not found');
    }
    return subscription;
  }

  private async findTargetPlan(
    subscription: BillingSubscriptionEntity,
    targetPlanCode: string,
    targetPlanPriceCode: string,
  ): Promise<BillingPlanEntity> {
    const targetPlan = await this.plans.findOne({
      where: {
        productId: subscription.plan.productId,
        code: targetPlanCode,
        status: BillingPlanStatus.Active,
      },
      relations: {
        versions: {
          prices: { providerPrices: true },
          entitlements: { feature: true },
        },
      },
    });

    if (!targetPlan) throw new NotFoundException('Target billing plan not found');
    const current = this.planResolver.resolve(
      subscription.plan,
      subscription.provider,
      subscription.planPriceCode ?? undefined,
    );
    const target = this.planResolver.resolve(
      targetPlan,
      subscription.provider,
      targetPlanPriceCode,
    );
    if (targetPlan.code === subscription.planCode) {
      throw new BadRequestException('Target plan must be different');
    }
    if (target.price.currency !== current.price.currency) {
      throw new BadRequestException('Target plan currency must match');
    }
    if (target.price.billingInterval !== current.price.billingInterval) {
      throw new BadRequestException('Target plan billing interval must match');
    }
    if (!target.providerPrice.providerPriceId) {
      throw new BadRequestException('Target PayPal plan id is required');
    }

    return targetPlan;
  }

  private async toResponse(subscription: BillingSubscriptionEntity) {
    const reloaded = subscription.plan
      ? subscription
      : await this.findSubscription(subscription.id);
    const resolution = await this.entitlements.resolveForSubscription(reloaded.id);
    return SubscriptionManagementMapper.toResponse(reloaded, resolution);
  }

  private mapPaypalSubscriptionStatus(
    paypalStatus: string | null,
  ): SubscriptionStatus {
    switch (paypalStatus) {
      case 'ACTIVE':
        return SubscriptionStatus.Active;
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
        return SubscriptionStatus.Pending;
    }
  }

  private mapLicenseStatus(status: SubscriptionStatus): LicenseStatus | null {
    switch (status) {
      case SubscriptionStatus.Active:
        return LicenseStatus.Active;
      case SubscriptionStatus.Suspended:
        return LicenseStatus.Suspended;
      case SubscriptionStatus.Cancelled:
      case SubscriptionStatus.Expired:
        return LicenseStatus.Revoked;
      default:
        return null;
    }
  }

  private mapCheckoutStatus(
    status: SubscriptionStatus,
  ): BillingCheckoutSessionStatus {
    switch (status) {
      case SubscriptionStatus.Active:
        return BillingCheckoutSessionStatus.Approved;
      case SubscriptionStatus.Cancelled:
      case SubscriptionStatus.Expired:
        return BillingCheckoutSessionStatus.Cancelled;
      default:
        return BillingCheckoutSessionStatus.Pending;
    }
  }

  private dateOrNull(value: unknown): Date | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private getNested(value: unknown, ...path: Array<string | number>): unknown {
    return path.reduce<unknown>((current, key) => {
      if (typeof key === 'number') {
        return Array.isArray(current) ? current[key] : undefined;
      }

      return this.asRecord(current)?.[key];
    }, value);
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
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
}
