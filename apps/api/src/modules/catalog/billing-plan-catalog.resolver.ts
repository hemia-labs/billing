import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProviderPriceEntity,
  BillingSubscriptionEntity,
  FeatureAggregationStrategy,
  FeatureValueType,
  PlanPriceBillingInterval,
  PlanPriceStatus,
  PlanVersionStatus,
  ProviderPriceStatus,
  BillingProvider,
} from '../billing-shared';

export type ResolvedPlanCatalog = {
  entitlements: Record<string, unknown>;
  plan: BillingPlanEntity;
  price: BillingPlanPriceEntity;
  providerPrice: BillingProviderPriceEntity;
  version: BillingPlanVersionEntity;
};

@Injectable()
export class BillingPlanCatalogResolver {
  publishedVersion(plan: BillingPlanEntity): BillingPlanVersionEntity {
    const now = Date.now();
    const version = [...(plan.versions ?? [])]
      .filter(
        (item) =>
          item.status === PlanVersionStatus.Published &&
          (!item.effectiveFrom || item.effectiveFrom.getTime() <= now) &&
          (!item.effectiveUntil || item.effectiveUntil.getTime() > now),
      )
      .sort((left, right) => right.version - left.version)[0];

    if (!version)
      throw new NotFoundException('Published billing plan version not found');
    return version;
  }

  contractVersion(
    subscription: BillingSubscriptionEntity,
  ): BillingPlanVersionEntity {
    const versions = subscription.plan?.versions ?? [];
    const priceId =
      subscription.planPriceId ?? subscription.providerPrice?.planPriceId;
    const providerPriceId = subscription.providerPriceId;
    if (!priceId && !providerPriceId)
      return this.publishedVersion(subscription.plan);

    const version = versions.find((item) =>
      (item.prices ?? []).some((price) =>
        priceId
          ? price.id === priceId
          : (price.providerPrices ?? []).some(
              (providerPrice) => providerPrice.id === providerPriceId,
            ),
      ),
    );
    if (!version)
      throw new NotFoundException('Contracted billing plan version not found');
    return version;
  }

  activePrice(
    version: BillingPlanVersionEntity,
    planPriceCode?: string,
  ): BillingPlanPriceEntity {
    const prices = [...(version.prices ?? [])]
      .filter((price) => price.status === PlanPriceStatus.Active)
      .sort(
        (left, right) =>
          left.billingInterval.localeCompare(right.billingInterval) ||
          left.billingIntervalCount - right.billingIntervalCount ||
          Number(left.amount) - Number(right.amount),
      );
    const price = planPriceCode
      ? prices.find((item) => item.code === planPriceCode)
      : prices[0];

    if (!price)
      throw new NotFoundException('Active billing plan price not found');
    return price;
  }

  providerPrice(
    price: BillingPlanPriceEntity,
    provider: BillingProvider,
  ): BillingProviderPriceEntity {
    const providerPrice = (price.providerPrices ?? []).find(
      (item) =>
        item.provider === provider &&
        item.status === ProviderPriceStatus.Active,
    );

    if (!providerPrice)
      throw new NotFoundException('Active provider price not found');
    return providerPrice;
  }

  resolve(
    plan: BillingPlanEntity,
    provider: BillingProvider,
    planPriceCode?: string,
  ): ResolvedPlanCatalog {
    const version = this.publishedVersion(plan);
    const price = this.activePrice(version, planPriceCode);
    const providerPrice = this.providerPrice(price, provider);

    return {
      entitlements: this.entitlements(version),
      plan,
      price,
      providerPrice,
      version,
    };
  }

  entitlements(version: BillingPlanVersionEntity): Record<string, unknown> {
    return Object.fromEntries(
      (version.entitlements ?? [])
        .filter((item) => item.feature?.code)
        .map((item) => [item.feature.code, this.unwrapValue(item.valueJson)]),
    );
  }

  validateFeatureValue(type: FeatureValueType, value: unknown): void {
    if (
      (type === FeatureValueType.Boolean && typeof value !== 'boolean') ||
      (type === FeatureValueType.Integer &&
        (typeof value !== 'number' || !Number.isInteger(value))) ||
      (type === FeatureValueType.Decimal &&
        (typeof value !== 'number' || !Number.isFinite(value))) ||
      (type === FeatureValueType.String && typeof value !== 'string') ||
      (type === FeatureValueType.Json && value === undefined)
    ) {
      throw new BadRequestException(
        'Invalid entitlement value for feature type',
      );
    }
  }

  aggregate(
    base: Record<string, unknown>,
    code: string,
    value: unknown,
    strategy: FeatureAggregationStrategy,
  ): void {
    const current = base[code];

    if (strategy === FeatureAggregationStrategy.Sum) {
      base[code] = this.number(current) + this.number(value);
    } else if (strategy === FeatureAggregationStrategy.Max) {
      base[code] = Math.max(this.number(current), this.number(value));
    } else if (strategy === FeatureAggregationStrategy.Min) {
      base[code] =
        current === undefined
          ? value
          : Math.min(this.number(current), this.number(value));
    } else if (strategy === FeatureAggregationStrategy.BooleanOr) {
      base[code] = Boolean(current) || Boolean(value);
    } else if (strategy === FeatureAggregationStrategy.BooleanAnd) {
      base[code] =
        current === undefined
          ? Boolean(value)
          : Boolean(current) && Boolean(value);
    } else {
      base[code] = value;
    }
  }

  toLegacyInterval(interval: PlanPriceBillingInterval): 'monthly' | 'yearly' {
    return interval === PlanPriceBillingInterval.Year ? 'yearly' : 'monthly';
  }

  number(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private unwrapValue(value: unknown): unknown {
    return this.isRecord(value) && 'value' in value ? value.value : value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
