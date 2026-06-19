import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillingAuditService } from '../audit';
import { DEFAULT_BILLING_CURRENCY } from '../billing-shared';
import {
  BillingEntitlementEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import { EntitlementStatus, SubscriptionAddonStatus } from '../billing-shared';
import {
  BillingAmountsSummary,
  BillingEntitlementsResolution,
  BillingEntitlementsSummary,
} from './types';

const EXTRA_USER_ADDON_CODE = 'extra_user';
const ENTITLEMENT_KEYS = [
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
        key: In(ENTITLEMENT_KEYS),
        status: EntitlementStatus.Active,
      },
    });

    if (persisted.length < ENTITLEMENT_KEYS.length) {
      return this.recalculate(subscriptionId);
    }

    return {
      entitlements: this.toEntitlementsSummary(persisted),
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
    const includedUsers = subscription.plan.seatsIncluded;
    const extraUsers = eligibleAddons
      .filter((addon) => addon.addonCode === EXTRA_USER_ADDON_CODE)
      .reduce((sum, addon) => sum + addon.quantity, 0);
    const maxAgents = this.numberFromFeature(subscription.plan.featuresJson.max_agents, 0);
    const maxConversationsMonthly = this.nullableNumberFromFeature(
      subscription.plan.featuresJson.max_conversations_monthly,
    );

    return {
      entitlements: {
        maxUsers: includedUsers + extraUsers,
        includedUsers,
        extraUsers,
        maxAgents,
        maxConversationsMonthly,
      },
      billing: this.calculateBilling(subscription, eligibleAddons),
    };
  }

  private calculateBilling(
    subscription: BillingSubscriptionEntity,
    activeAddons: BillingSubscriptionAddonEntity[],
  ): BillingAmountsSummary {
    const baseCents = this.toCents(subscription.plan.amount);
    const addonsCents = activeAddons.reduce(
      (sum, addon) => sum + this.toCents(addon.unitPrice) * addon.quantity,
      0,
    );

    return {
      baseMonthly: this.centsToDecimal(baseCents),
      addonsMonthly: this.centsToDecimal(addonsCents),
      totalMonthly: this.centsToDecimal(baseCents + addonsCents),
      currency: subscription.plan.currency,
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
  ): BillingEntitlementsSummary {
    const values = new Map(entitlements.map((item) => [item.key, item]));
    const conversations = values.get('max_conversations_monthly');

    return {
      maxUsers: values.get('max_users')?.value ?? 0,
      includedUsers: values.get('included_users')?.value ?? 0,
      extraUsers: values.get('extra_users')?.value ?? 0,
      maxAgents: values.get('max_agents')?.value ?? 0,
      maxConversationsMonthly: conversations?.metadata?.nullable
        ? null
        : conversations?.value ?? null,
    };
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
