import { BadRequestException } from '@nestjs/common';
import {
  BillingFeatureDefinitionEntity,
  BillingPlanEntitlementEntity,
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProviderPriceEntity,
  FeatureValueType,
  PlanPriceBillingInterval,
  PlanPriceStatus,
  PlanVersionStatus,
  ProviderPriceStatus,
  BillingProvider,
  BillingPlanStatus,
  FeatureAggregationStrategy,
} from '../src/modules/billing-shared';
import { BillingPlanCatalogResolver } from '../src/modules/catalog';
import { BillingCatalogMapper } from '../src/modules/catalog/mappers';

function planFixture(): BillingPlanEntity {
  const plan = new BillingPlanEntity();
  plan.id = 'plan-id';
  plan.productId = 'product-id';
  plan.code = 'medsync_clinic';
  plan.name = 'Clinica';
  plan.description = null;
  plan.status = BillingPlanStatus.Active;

  const version = new BillingPlanVersionEntity();
  version.id = 'version-id';
  version.planId = plan.id;
  version.version = 1;
  version.status = PlanVersionStatus.Published;

  const price = new BillingPlanPriceEntity();
  price.id = 'price-id';
  price.planVersionId = version.id;
  price.code = 'medsync_clinic_monthly_mxn';
  price.billingInterval = PlanPriceBillingInterval.Month;
  price.billingIntervalCount = 1;
  price.currency = 'MXN';
  price.amount = '1299.00';
  price.status = PlanPriceStatus.Active;

  const providerPrice = new BillingProviderPriceEntity();
  providerPrice.provider = BillingProvider.Paypal;
  providerPrice.providerPriceId = 'paypal-plan-id';
  providerPrice.status = ProviderPriceStatus.Active;
  price.providerPrices = [providerPrice];

  const feature = new BillingFeatureDefinitionEntity();
  feature.code = 'users.included';

  const entitlement = new BillingPlanEntitlementEntity();
  entitlement.feature = feature;
  entitlement.valueJson = 10;

  version.prices = [price];
  version.entitlements = [entitlement];
  plan.versions = [version];

  return plan;
}

describe('catalog plan model', () => {
  it('maps nested catalog fields from published version data', () => {
    const dto = BillingCatalogMapper.toPlanDto(planFixture());

    expect(dto.versions[0].prices[0].amount).toBe('1299.00');
    expect(dto.versions[0].prices[0].providerPrices[0].providerPriceId).toBe('paypal-plan-id');
  });

  it('resolves users.included from plan entitlements', () => {
    const resolver = new BillingPlanCatalogResolver();
    const version = resolver.publishedVersion(planFixture());

    expect(resolver.entitlements(version)['users.included']).toBe(10);
  });

  it('selects price by planPriceCode', () => {
    const resolver = new BillingPlanCatalogResolver();
    const plan = planFixture();
    const yearly = new BillingPlanPriceEntity();
    yearly.id = 'yearly-price-id';
    yearly.planVersionId = 'version-id';
    yearly.code = 'medsync_clinic_yearly_mxn';
    yearly.billingInterval = PlanPriceBillingInterval.Year;
    yearly.billingIntervalCount = 1;
    yearly.currency = 'MXN';
    yearly.amount = '12990.00';
    yearly.status = PlanPriceStatus.Active;
    yearly.providerPrices = [];
    plan.versions![0].prices!.push(yearly);

    expect(
      resolver.activePrice(plan.versions![0], 'medsync_clinic_yearly_mxn').id,
    ).toBe('yearly-price-id');
  });

  it('fails when provider price is missing', () => {
    const resolver = new BillingPlanCatalogResolver();
    const plan = planFixture();
    plan.versions![0].prices![0].providerPrices = [];

    expect(() => resolver.resolve(plan, BillingProvider.Paypal, 'medsync_clinic_monthly_mxn'))
      .toThrow('Active provider price not found');
  });

  it('validates entitlement values against feature value type', () => {
    const resolver = new BillingPlanCatalogResolver();

    expect(() => resolver.validateFeatureValue(FeatureValueType.Integer, true))
      .toThrow(BadRequestException);
  });

  it('aggregates values by strategy', () => {
    const resolver = new BillingPlanCatalogResolver();
    const values: Record<string, unknown> = { seats: 2, handoff: false };

    resolver.aggregate(values, 'seats', 3, FeatureAggregationStrategy.Sum);
    resolver.aggregate(values, 'handoff', true, FeatureAggregationStrategy.BooleanOr);

    expect(values).toEqual({ seats: 5, handoff: true });
  });
});
