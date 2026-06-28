import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BillingAuditService } from '../audit';
import { BillingPlanCatalogResolver } from '../catalog';
import {
  BillingAddonEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
  BillingUsageCounterEntity,
} from '../billing-shared';
import {
  AddonStatus,
  BillingAddonPricingModel,
  BillingAddonType,
  SubscriptionAddonStatus,
  SubscriptionStatus,
} from '../billing-shared';
import { BillingEntitlementsService } from '../entitlements';
import { PaypalClientService } from '../paypal';
import { ConfigService } from '@nestjs/config';
import {
  CreateSubscriptionAddonDto,
  SubscriptionAddonResponseDto,
  SubscriptionAddonSummaryResponseDto,
} from './dtos';
import { SubscriptionAddonMapper } from './mappers';

const ALLOWED_SUBSCRIPTION_STATUSES = [
  SubscriptionStatus.Active,
  SubscriptionStatus.PastDue,
];

@Injectable()
export class BillingSubscriptionAddonsService {
  constructor(
    @InjectRepository(BillingSubscriptionAddonEntity)
    private readonly subscriptionAddons: Repository<BillingSubscriptionAddonEntity>,
    @InjectRepository(BillingSubscriptionEntity)
    private readonly subscriptions: Repository<BillingSubscriptionEntity>,
    @InjectRepository(BillingAddonEntity)
    private readonly addons: Repository<BillingAddonEntity>,
    @InjectRepository(BillingUsageCounterEntity)
    private readonly usageCounters: Repository<BillingUsageCounterEntity>,
    private readonly audit: BillingAuditService,
    private readonly entitlements: BillingEntitlementsService,
    private readonly paypal: PaypalClientService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly planResolver: BillingPlanCatalogResolver,
  ) {}

  async createPendingAddon(
    subscriptionId: string,
    dto: CreateSubscriptionAddonDto,
  ): Promise<SubscriptionAddonResponseDto> {
    const subscription = await this.findEligibleSubscription(subscriptionId);
    const addon = await this.findEligibleAddon(subscription, dto.addonCode);
    this.validateQuantity(addon, dto.quantity);
    const existingByKey = dto.idempotencyKey
      ? await this.subscriptionAddons.findOne({
          where: { subscriptionId: subscription.id, idempotencyKey: dto.idempotencyKey },
          relations: {
            addon: true,
            subscription: {
              plan: {
                versions: {
                  prices: { providerPrices: true },
                  entitlements: { feature: true },
                },
              },
              planPrice: true,
              providerPrice: true,
            },
          },
        })
      : null;
    if (existingByKey) return SubscriptionAddonMapper.toDto(existingByKey);
    const existingPending = await this.subscriptionAddons.findOne({
      where: {
        subscriptionId: subscription.id,
        addonId: addon.id,
        status: SubscriptionAddonStatus.PendingPayment,
      },
    });

    if (existingPending) {
      throw new ConflictException('A pending payment already exists for this add-on');
    }
    const entity = this.subscriptionAddons.create({
        subscriptionId: subscription.id,
        subscription,
        addonId: addon.id,
        addon,
        addonCode: addon.code,
        status: SubscriptionAddonStatus.PendingPayment,
        providerSubscriptionId: null,
        idempotencyKey: dto.idempotencyKey ?? null,
      });

    entity.quantity = dto.quantity;
    entity.unitPrice = addon.unitPrice;
    entity.currency = addon.currency;
    entity.billingInterval = addon.billingInterval;
    entity.pricingModel = addon.pricingModel;
    entity.entitlementEffects = addon.entitlementEffects;
    entity.provider = addon.provider;
    entity.providerReferenceId = addon.providerPlanId;
    entity.pendingEffectiveAt = subscription.nextBillingTime ?? subscription.currentPeriodEnd;
    entity.currentPeriodEnd = subscription.currentPeriodEnd;
    entity.metadata = {
      ...(entity.metadata ?? {}),
    };

    const saved = await this.subscriptionAddons.save(entity);
    await this.audit.record({
      organizationId: subscription.organizationId,
      action: 'billing.subscription_addon.pending_created',
      resourceType: 'billing_subscription_addon',
      resourceId: saved.id,
      metadata: {
        subscriptionAddonId: saved.id,
        subscriptionId: subscription.id,
        addonCode: saved.addonCode,
        quantity: saved.quantity,
        newStatus: saved.status,
      },
    });

    return SubscriptionAddonMapper.toDto(saved);
  }

  async createApproval(
    subscriptionId: string,
    dto: CreateSubscriptionAddonDto,
    actorUserId: string,
  ): Promise<{ addon: SubscriptionAddonResponseDto; approvalUrl: string | null }> {
    const pending = await this.createPendingAddon(subscriptionId, dto);
    const entity = await this.findSubscriptionAddon(pending.id);

    if (entity.providerSubscriptionId) {
      const provider = await this.paypal.getSubscription(entity.providerSubscriptionId);
      return { addon: SubscriptionAddonMapper.toDto(entity), approvalUrl: provider.approvalUrl ?? null };
    }
    if (!entity.providerReferenceId) {
      throw new BadRequestException('PayPal plan id is required for add-on checkout');
    }

    try {
      const created = await this.paypal.createSubscription({
        providerPlanId: entity.providerReferenceId,
        customId: entity.id,
        quantity: entity.quantity,
        requestId: entity.idempotencyKey ?? entity.id,
        returnUrl: this.callbackUrl(entity.id, 'success'),
        cancelUrl: this.callbackUrl(entity.id, 'cancel'),
      });
      entity.providerSubscriptionId = created.id;
      const saved = await this.subscriptionAddons.save(entity);
      await this.audit.record({
        organizationId: entity.subscription.organizationId,
        actorUserId,
        action: 'billing.subscription_addon.provider_linked',
        resourceType: 'billing_subscription_addon',
        resourceId: saved.id,
        provider: saved.provider,
        metadata: {
          subscriptionAddonId: saved.id,
          subscriptionId: saved.subscriptionId,
          addonCode: saved.addonCode,
        },
      });
      return { addon: SubscriptionAddonMapper.toDto(saved), approvalUrl: created.approvalUrl ?? null };
    } catch (error) {
      entity.status = SubscriptionAddonStatus.Failed;
      await this.subscriptionAddons.save(entity);
      await this.audit.record({
        organizationId: entity.subscription.organizationId,
        actorUserId,
        action: 'billing.subscription_addon.failed',
        resourceType: 'billing_subscription_addon',
        resourceId: entity.id,
        provider: entity.provider,
        metadata: { subscriptionAddonId: entity.id, subscriptionId: entity.subscriptionId, addonCode: entity.addonCode, newStatus: entity.status },
      });
      throw error;
    }
  }

  async activateAddon(id: string): Promise<SubscriptionAddonResponseDto> {
    const entity = await this.findSubscriptionAddon(id);

    if (entity.status !== SubscriptionAddonStatus.PendingPayment) {
      throw new BadRequestException('Only pending add-ons can be activated');
    }

    const previousStatus = entity.status;
    entity.status = SubscriptionAddonStatus.Active;
    const saved = await this.subscriptionAddons.save(entity);

    await this.audit.record({
      organizationId: saved.subscription.organizationId,
      action: 'billing.subscription_addon.activated',
      resourceType: 'billing_subscription_addon',
      resourceId: saved.id,
      metadata: {
        subscriptionAddonId: saved.id,
        subscriptionId: saved.subscriptionId,
        addonCode: saved.addonCode,
        quantity: saved.quantity,
        previousStatus,
        newStatus: saved.status,
      },
    });
    await this.entitlements.recalculate(saved.subscriptionId);

    return SubscriptionAddonMapper.toDto(saved);
  }

  async scheduleCancel(
    id: string,
    actorUserId?: string,
  ): Promise<SubscriptionAddonResponseDto> {
    const entity = await this.findSubscriptionAddon(id);
    if (entity.status !== SubscriptionAddonStatus.Active) {
      throw new BadRequestException('Only active add-ons can be cancelled');
    }
    const previousStatus = entity.status;
    const limits = await this.calculateNumericLimits(entity.subscriptionId, entity);
    const usage = await this.usageCounters.find({
      where: {
        organizationId: entity.subscription.organizationId,
        productCode: entity.subscription.productCode,
      },
    });
    const blockedLimit = usage.find(
      (counter) =>
        limits[counter.key] !== undefined &&
        counter.currentValue > limits[counter.key],
    );

    if (blockedLimit) {
      entity.status = SubscriptionAddonStatus.Blocked;
      entity.metadata = {
        ...entity.metadata,
        blockReason: 'usage_exceeds_new_limit',
        usageKey: blockedLimit.key,
        currentUsage: blockedLimit.currentValue,
        requestedLimit: limits[blockedLimit.key],
      };
      const blocked = await this.subscriptionAddons.save(entity);
      return SubscriptionAddonMapper.toDto(blocked);
    }

    entity.status = SubscriptionAddonStatus.ScheduledCancel;
    entity.pendingEffectiveAt =
      entity.subscription.nextBillingTime ?? entity.subscription.currentPeriodEnd;
    entity.currentPeriodEnd = entity.subscription.currentPeriodEnd;
    const saved = await this.subscriptionAddons.save(entity);

    await this.audit.record({
      organizationId: saved.subscription.organizationId,
      actorUserId,
      action: 'billing.subscription_addon.cancel_scheduled',
      resourceType: 'billing_subscription_addon',
      resourceId: saved.id,
      metadata: {
        subscriptionAddonId: saved.id,
        subscriptionId: saved.subscriptionId,
        addonCode: saved.addonCode,
        quantity: saved.quantity,
        previousStatus,
        newStatus: saved.status,
      },
    });

    return SubscriptionAddonMapper.toDto(saved);
  }

  async getSummary(
    subscriptionId: string,
  ): Promise<SubscriptionAddonSummaryResponseDto> {
    const subscription = await this.findSubscription(subscriptionId);
    const addons = await this.subscriptionAddons.find({
      where: { subscriptionId },
      relations: {
        addon: true,
        subscription: {
          plan: {
            versions: {
              prices: { providerPrices: true },
              entitlements: { feature: true },
            },
          },
          planPrice: true,
          providerPrice: true,
        },
      },
      order: { createdAt: 'ASC' },
    });
    const activeAddons = addons.filter(
      (addon) => addon.status === SubscriptionAddonStatus.Active,
    );
    const planPrice = subscription.planPrice ?? this.planResolver.activePrice(
      this.planResolver.publishedVersion(subscription.plan),
      subscription.planPriceCode ?? undefined,
    );
    const baseAmount = planPrice.amount;
    const addonsAmount = this.centsToDecimal(
      activeAddons.reduce(
        (sum, addon) => sum + this.toCents(addon.unitPrice) * addon.quantity,
        0,
      ),
    );
    const totalAmount = this.centsToDecimal(
      this.toCents(baseAmount) + this.toCents(addonsAmount),
    );

    return SubscriptionAddonMapper.toSummary({
      subscriptionId: subscription.id,
      planCode: subscription.planCode,
      baseAmount,
      addonsAmount,
      totalAmount,
      currency: planPrice.currency,
      addons,
    });
  }

  async processDueCancellations(): Promise<void> {
    const due = await this.subscriptionAddons.find({
      where: { status: SubscriptionAddonStatus.ScheduledCancel },
    });
    await Promise.all(due.filter((addon) => addon.pendingEffectiveAt && addon.pendingEffectiveAt <= new Date()).map((addon) => this.cancelDueAddon(addon.id)));
  }

  private async cancelDueAddon(id: string): Promise<void> {
    let subscriptionId: string | null = null;
    await this.dataSource.transaction(async (manager) => {
      const addons = manager.getRepository(BillingSubscriptionAddonEntity);
      const addon = await addons.findOne({
        where: { id, status: SubscriptionAddonStatus.ScheduledCancel },
        relations: { subscription: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!addon || !addon.pendingEffectiveAt || addon.pendingEffectiveAt > new Date()) return;
      if (!addon.providerSubscriptionId) throw new BadRequestException('Provider subscription id is missing');
      const provider = await this.paypal.getSubscription(addon.providerSubscriptionId);
      if (!['CANCELLED', 'EXPIRED'].includes(provider.status ?? '')) {
        await this.paypal.cancelSubscription({ providerSubscriptionId: addon.providerSubscriptionId, reason: 'Scheduled add-on cancellation' });
      }
      addon.status = SubscriptionAddonStatus.Cancelled;
      await addons.save(addon);
      await this.audit.record({
        manager,
        organizationId: addon.subscription.organizationId,
        action: 'billing.subscription_addon.cancelled',
        resourceType: 'billing_subscription_addon',
        resourceId: addon.id,
        provider: addon.provider,
        metadata: { subscriptionAddonId: addon.id, subscriptionId: addon.subscriptionId, addonCode: addon.addonCode, newStatus: addon.status },
      });
      subscriptionId = addon.subscriptionId;
    });
    if (subscriptionId) await this.entitlements.recalculate(subscriptionId);
  }

  private callbackUrl(subscriptionAddonId: string, approval: 'success' | 'cancel'): string {
    const frontendUrl = this.config.get<string>('sso.frontendUrl') ?? '';
    const url = new URL('/addons', frontendUrl);
    url.searchParams.set('subscription_addon_id', subscriptionAddonId);
    url.searchParams.set('approval', approval);
    return url.toString();
  }

  private async calculateNumericLimits(
    subscriptionId: string,
    excludedSubscriptionAddon?: BillingSubscriptionAddonEntity,
  ): Promise<Record<string, number>> {
    const subscription = await this.findSubscription(subscriptionId);
    const activeAddons = await this.subscriptionAddons.find({
      where: {
        subscriptionId,
        status: SubscriptionAddonStatus.Active,
      },
    });
    const features = this.planResolver.entitlements(
      this.planResolver.publishedVersion(subscription.plan),
    );
    const limits: Record<string, number> = {
      max_users: this.numberFromFeature(features['users.max']) || this.numberFromFeature(features['users.included']),
      max_agents: this.numberFromFeature(features['ai_agents.max']),
      max_conversations_monthly: this.numberFromFeature(features['conversations.monthly']),
    };

    for (const key of Object.keys(
      excludedSubscriptionAddon?.entitlementEffects?.numeric ?? {},
    )) {
      limits[key] ??= 0;
    }

    for (const addon of activeAddons
      .filter((addon) => addon.id !== excludedSubscriptionAddon?.id)
    ) {
      const multiplier =
        addon.pricingModel === BillingAddonPricingModel.PerUnit
          ? addon.quantity
          : 1;
      for (const [key, value] of Object.entries(
        addon.entitlementEffects?.numeric ?? {},
      )) {
        limits[key] = (limits[key] ?? 0) + value * multiplier;
      }
    }

    return limits;
  }

  private async findEligibleSubscription(
    subscriptionId: string,
  ): Promise<BillingSubscriptionEntity> {
    const subscription = await this.findSubscription(subscriptionId);

    if (!ALLOWED_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
      throw new BadRequestException('Subscription status does not allow add-ons');
    }

    return subscription;
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

    if (!subscription) throw new NotFoundException('Billing subscription not found');
    return subscription;
  }

  private async findEligibleAddon(
    subscription: BillingSubscriptionEntity,
    addonCode: string,
  ): Promise<BillingAddonEntity> {
    const addon = await this.addons.findOne({
      where: {
        productCode: subscription.productCode,
        code: addonCode,
        status: AddonStatus.Active,
      },
    });

    if (!addon) throw new NotFoundException('Billing addon not found');
    if (addon.type !== BillingAddonType.Recurring) {
      throw new BadRequestException('Only recurring add-ons are supported');
    }
    const planPrice = subscription.planPrice ?? this.planResolver.activePrice(
      this.planResolver.publishedVersion(subscription.plan),
      subscription.planPriceCode ?? undefined,
    );
    if (addon.currency !== planPrice.currency) {
      throw new BadRequestException('Addon currency does not match plan currency');
    }
    if (addon.billingInterval !== this.planResolver.toLegacyInterval(planPrice.billingInterval)) {
      throw new BadRequestException('Addon billing interval does not match plan');
    }
    if (addon.provider !== subscription.provider) {
      throw new BadRequestException('Addon provider does not match subscription');
    }

    return addon;
  }

  private numberFromFeature(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private async findSubscriptionAddon(
    id: string,
  ): Promise<BillingSubscriptionAddonEntity> {
    const entity = await this.subscriptionAddons.findOne({
      where: { id },
      relations: {
        addon: true,
        subscription: {
          plan: {
            versions: {
              prices: { providerPrices: true },
              entitlements: { feature: true },
            },
          },
        },
      },
    });

    if (!entity) throw new NotFoundException('Billing subscription add-on not found');
    return entity;
  }

  private validateQuantity(addon: BillingAddonEntity, quantity: number): void {
    if (quantity < addon.minQuantity) {
      throw new BadRequestException('Addon quantity is below the minimum');
    }
    if (addon.maxQuantity !== null && quantity > addon.maxQuantity) {
      throw new BadRequestException('Addon quantity exceeds the maximum');
    }
    if (
      addon.pricingModel === BillingAddonPricingModel.Flat &&
      quantity !== 1
    ) {
      throw new BadRequestException('Flat add-ons require quantity 1');
    }
  }

  private toCents(amount: string): number {
    return Math.round(Number(amount) * 100);
  }

  private centsToDecimal(cents: number): string {
    return (cents / 100).toFixed(2);
  }
}
