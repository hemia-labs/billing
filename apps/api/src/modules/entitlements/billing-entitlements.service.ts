import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingAuditService } from '../audit';
import { BillingPlanCatalogResolver } from '../catalog';
import { DEFAULT_BILLING_CURRENCY } from '../billing-shared';
import {
  BillingEntitlementEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import {
  BillingAddonPricingModel,
  EntitlementStatus,
  FeatureAggregationStrategy,
  SubscriptionAddonStatus,
} from '../billing-shared';
import {
  BillingAmountsSummary,
  BillingEntitlementsResolution,
  BillingEntitlementsSummary,
} from './types';

const CORE_ENTITLEMENT_KEYS = [
  'max_users',
  'included_users',
  'extra_users',
  'max_agents',
  'max_conversations_monthly',
];

@Injectable()
export class BillingEntitlementsService {
  constructor(
    @InjectRepository(BillingSubscriptionEntity)
    private readonly subscriptions: Repository<BillingSubscriptionEntity>,
    @InjectRepository(BillingSubscriptionAddonEntity)
    private readonly subscriptionAddons: Repository<BillingSubscriptionAddonEntity>,
    @InjectRepository(BillingEntitlementEntity)
    private readonly entitlements: Repository<BillingEntitlementEntity>,
    private readonly audit: BillingAuditService,
    private readonly planResolver: BillingPlanCatalogResolver,
  ) {}

  async recalculate(
    subscriptionId: string,
  ): Promise<BillingEntitlementsResolution> {
    const subscription = await this.findSubscription(subscriptionId);
    const activeAddons = await this.findActiveAddons(subscriptionId);
    const resolution = this.calculate(subscription, activeAddons);

    await this.upsertEntitlements(subscription, resolution.entitlements);
    await this.audit.record({
      organizationId: subscription.organizationId,
      action: 'billing.entitlements.recalculated',
      resourceType: 'billing_subscription',
      resourceId: subscription.id,
      metadata: {
        subscriptionId: subscription.id,
        newStatus: EntitlementStatus.Active,
      },
    });

    return resolution;
  }

  async resolveForSubscription(
    subscriptionId: string,
  ): Promise<BillingEntitlementsResolution> {
    const subscription = await this.findSubscription(subscriptionId);
    const activeAddons = await this.findActiveAddons(subscriptionId);
    const persisted = await this.entitlements.find({
      where: {
        subscriptionId,
        status: EntitlementStatus.Active,
      },
    });

    if (
      CORE_ENTITLEMENT_KEYS.some(
        (key) => !persisted.some((entitlement) => entitlement.key === key),
      )
    ) {
      return this.recalculate(subscriptionId);
    }

    return {
      entitlements: this.toEntitlementsSummary(persisted, activeAddons),
      billing: this.calculateBilling(subscription, activeAddons),
    };
  }

  async markStale(subscriptionId: string): Promise<void> {
    const current = await this.entitlements.find({
      where: { subscriptionId, status: EntitlementStatus.Active },
    });

    await Promise.all(
      current.map((entitlement) =>
        this.entitlements.save({
          ...entitlement,
          status: EntitlementStatus.Stale,
        }),
      ),
    );
  }

  emptyResolution(): BillingEntitlementsResolution {
    return {
      entitlements: {
        maxUsers: 0,
        includedUsers: 0,
        extraUsers: 0,
        maxAgents: 0,
        maxConversationsMonthly: null,
        additional: {},
        featureFlags: {},
      },
      billing: {
        baseMonthly: '0.00',
        addonsMonthly: '0.00',
        totalMonthly: '0.00',
        currency: DEFAULT_BILLING_CURRENCY,
      },
    };
  }

  private calculate(
    subscription: BillingSubscriptionEntity,
    activeAddons: BillingSubscriptionAddonEntity[],
  ): BillingEntitlementsResolution {
    const eligibleAddons = activeAddons.filter(
      (addon) => addon.status === SubscriptionAddonStatus.Active,
    );
    const version = this.planResolver.publishedVersion(subscription.plan);
    const price = subscription.planPrice ?? this.planResolver.activePrice(version, subscription.planPriceCode ?? undefined);
    const planEntitlements = this.planResolver.entitlements(version);
    const numeric: Record<string, number> = {
      included_users: this.numberFromFeature(planEntitlements['users.included'], 0),
      max_users: this.numberFromFeature(
        planEntitlements['users.max'],
        this.numberFromFeature(planEntitlements['users.included'], 0),
      ),
      max_agents: this.numberFromFeature(planEntitlements['ai_agents.max'], 0),
      max_conversations_monthly: this.numberFromFeature(
        planEntitlements['conversations.monthly'],
        0,
      ),
    };
    const featureFlags: Record<string, boolean> = Object.fromEntries(
      Object.entries(planEntitlements).filter(([, value]) => typeof value === 'boolean'),
    ) as Record<string, boolean>;

    for (const addon of eligibleAddons) {
      const multiplier =
        addon.pricingModel === BillingAddonPricingModel.PerUnit
          ? addon.quantity
          : 1;
      for (const [key, value] of Object.entries(
        addon.entitlementEffects?.numeric ?? {},
      )) {
        this.planResolver.aggregate(
          numeric,
          key,
          value * multiplier,
          FeatureAggregationStrategy.Sum,
        );
      }
      Object.assign(featureFlags, addon.entitlementEffects?.features ?? {});
    }

    const coreKeys = new Set(CORE_ENTITLEMENT_KEYS);
    const additional = Object.fromEntries(
      Object.entries(numeric).filter(([key]) => !coreKeys.has(key)),
    );

    return {
      entitlements: {
        maxUsers: numeric.max_users,
        includedUsers: numeric.included_users,
        extraUsers: numeric.max_users - numeric.included_users,
        maxAgents: numeric.max_agents,
        maxConversationsMonthly: this.nullableNumberFromFeature(
          planEntitlements['conversations.monthly'],
        ) === null && numeric.max_conversations_monthly === 0
          ? null
          : numeric.max_conversations_monthly,
        additional,
        featureFlags,
      },
      billing: this.calculateBilling(subscription, eligibleAddons, price),
    };
  }

  private calculateBilling(
    subscription: BillingSubscriptionEntity,
    activeAddons: BillingSubscriptionAddonEntity[],
    price = subscription.planPrice ?? this.planResolver.activePrice(
      this.planResolver.publishedVersion(subscription.plan),
      subscription.planPriceCode ?? undefined,
    ),
  ): BillingAmountsSummary {
    const baseCents = this.toCents(price.amount);
    const addonsCents = activeAddons.reduce(
      (sum, addon) => sum + this.toCents(addon.unitPrice) * addon.quantity,
      0,
    );

    return {
      baseMonthly: this.centsToDecimal(baseCents),
      addonsMonthly: this.centsToDecimal(addonsCents),
      totalMonthly: this.centsToDecimal(baseCents + addonsCents),
      currency: price.currency,
    };
  }

  private async upsertEntitlements(
    subscription: BillingSubscriptionEntity,
    summary: BillingEntitlementsSummary,
  ): Promise<void> {
    const values = new Map<string, number | null>([
      ['max_users', summary.maxUsers],
      ['included_users', summary.includedUsers],
      ['extra_users', summary.extraUsers],
      ['max_agents', summary.maxAgents],
      ['max_conversations_monthly', summary.maxConversationsMonthly],
      ...Object.entries(summary.additional),
    ]);

    await Promise.all(
      Array.from(values.entries()).map(async ([key, rawValue]) => {
        const existing = await this.entitlements.findOne({
          where: { subscriptionId: subscription.id, key },
        });
        const entitlement =
          existing ??
          this.entitlements.create({
            organizationId: subscription.organizationId,
            subscriptionId: subscription.id,
            subscription,
            productCode: subscription.productCode,
            key,
          });

        entitlement.value = rawValue ?? 0;
        entitlement.status = EntitlementStatus.Active;
        entitlement.metadata = { nullable: rawValue === null };
        await this.entitlements.save(entitlement);
      }),
    );
  }

  private toEntitlementsSummary(
    entitlements: BillingEntitlementEntity[],
    activeAddons: BillingSubscriptionAddonEntity[],
  ): BillingEntitlementsSummary {
    const values = new Map(entitlements.map((item) => [item.key, item]));
    const conversations = values.get('max_conversations_monthly');

    const featureFlags = activeAddons.reduce<Record<string, boolean>>(
      (flags, addon) => ({
        ...flags,
        ...(addon.entitlementEffects?.features ?? {}),
      }),
      {},
    );
    const additional = Object.fromEntries(
      entitlements
        .filter((item) => !CORE_ENTITLEMENT_KEYS.includes(item.key))
        .map((item) => [item.key, item.value]),
    );

    return {
      maxUsers: values.get('max_users')?.value ?? 0,
      includedUsers: values.get('included_users')?.value ?? 0,
      extraUsers: values.get('extra_users')?.value ?? 0,
      maxAgents: values.get('max_agents')?.value ?? 0,
      maxConversationsMonthly: conversations?.metadata?.nullable
        ? null
        : conversations?.value ?? null,
      additional,
      featureFlags,
    };
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

  private findActiveAddons(
    subscriptionId: string,
  ): Promise<BillingSubscriptionAddonEntity[]> {
    return this.subscriptionAddons.find({
      where: { subscriptionId, status: SubscriptionAddonStatus.Active },
    });
  }

  private numberFromFeature(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private nullableNumberFromFeature(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private toCents(amount: string): number {
    return Math.round(Number(amount) * 100);
  }

  private centsToDecimal(cents: number): string {
    return (cents / 100).toFixed(2);
  }
}
