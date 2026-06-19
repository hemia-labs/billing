import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingAuditService } from '../audit';
import {
  BillingAddonEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
  BillingUsageCounterEntity,
} from '../billing-shared';
import {
  AddonStatus,
  BillingAddonType,
  SubscriptionAddonStatus,
  SubscriptionStatus,
} from '../billing-shared';
import { BillingEntitlementsService } from '../entitlements';
import {
  CreateSubscriptionAddonDto,
  SubscriptionAddonResponseDto,
  SubscriptionAddonSummaryResponseDto,
} from './dtos';
import { SubscriptionAddonMapper } from './mappers';

const EXTRA_USER_ADDON_CODE = 'extra_user';
const MAX_USERS_KEY = 'max_users';
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
  ) {}

  async createPendingAddon(
    subscriptionId: string,
    dto: CreateSubscriptionAddonDto,
  ): Promise<SubscriptionAddonResponseDto> {
    const subscription = await this.findEligibleSubscription(subscriptionId);
    const addon = await this.findEligibleAddon(subscription, dto.addonCode);
    const existingPending = await this.subscriptionAddons.findOne({
      where: {
        subscriptionId: subscription.id,
        addonId: addon.id,
        status: SubscriptionAddonStatus.PendingPayment,
      },
    });

    const entity =
      existingPending ??
      this.subscriptionAddons.create({
        subscriptionId: subscription.id,
        subscription,
        addonId: addon.id,
        addon,
        addonCode: addon.code,
        status: SubscriptionAddonStatus.PendingPayment,
      });

    entity.quantity = dto.quantity;
    entity.unitPrice = addon.unitPrice;
    entity.currency = addon.currency;
    entity.billingInterval = addon.billingInterval;
    entity.pendingEffectiveAt = subscription.nextBillingTime ?? subscription.currentPeriodEnd;
    entity.currentPeriodEnd = subscription.currentPeriodEnd;
    entity.metadata = {
      ...(entity.metadata ?? {}),
      idempotencyKey: dto.idempotencyKey ?? null,
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

  async scheduleCancel(id: string): Promise<SubscriptionAddonResponseDto> {
    const entity = await this.findSubscriptionAddon(id);
    const previousStatus = entity.status;
    const newLimit = await this.calculateMaxUsers(entity.subscriptionId, id);
    const usage = await this.usageCounters.findOne({
      where: {
        organizationId: entity.subscription.organizationId,
        productCode: entity.subscription.productCode,
        key: MAX_USERS_KEY,
      },
    });

    if ((usage?.currentValue ?? 0) > newLimit) {
      entity.status = SubscriptionAddonStatus.Blocked;
      entity.metadata = {
        ...entity.metadata,
        blockReason: 'usage_exceeds_new_limit',
        currentUsage: usage?.currentValue ?? 0,
        requestedLimit: newLimit,
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
      relations: { addon: true, subscription: { plan: true } },
      order: { createdAt: 'ASC' },
    });
    const activeAddons = addons.filter(
      (addon) => addon.status === SubscriptionAddonStatus.Active,
    );
    const baseAmount = subscription.plan.amount;
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
      currency: subscription.plan.currency,
      addons,
    });
  }

  private async calculateMaxUsers(
    subscriptionId: string,
    excludingSubscriptionAddonId?: string,
  ): Promise<number> {
    const subscription = await this.findSubscription(subscriptionId);
    const activeAddons = await this.subscriptionAddons.find({
      where: {
        subscriptionId,
        status: SubscriptionAddonStatus.Active,
      },
    });
    const extraUsers = activeAddons
      .filter((addon) => addon.id !== excludingSubscriptionAddonId)
      .filter((addon) => addon.addonCode === EXTRA_USER_ADDON_CODE)
      .reduce((sum, addon) => sum + addon.quantity, 0);

    return subscription.plan.seatsIncluded + extraUsers;
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
      relations: { plan: true },
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
    if (addon.currency !== subscription.plan.currency) {
      throw new BadRequestException('Addon currency does not match plan currency');
    }
    if (addon.billingInterval !== subscription.plan.billingInterval) {
      throw new BadRequestException('Addon billing interval does not match plan');
    }

    return addon;
  }

  private async findSubscriptionAddon(
    id: string,
  ): Promise<BillingSubscriptionAddonEntity> {
    const entity = await this.subscriptionAddons.findOne({
      where: { id },
      relations: { addon: true, subscription: { plan: true } },
    });

    if (!entity) throw new NotFoundException('Billing subscription add-on not found');
    return entity;
  }

  private toCents(amount: string): number {
    return Math.round(Number(amount) * 100);
  }

  private centsToDecimal(cents: number): string {
    return (cents / 100).toFixed(2);
  }
}
