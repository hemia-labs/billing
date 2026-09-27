import { BadRequestException } from '@nestjs/common';
import {
  BillingFeatureDefinitionEntity,
  BillingProductEntity,
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
  BillingProductStatus,
  FeatureAggregationStrategy,
} from '../src/modules/billing-shared';
import {
  BillingCatalogService,
  BillingPlanCatalogResolver,
} from '../src/modules/catalog';
import { BillingCatalogMapper } from '../src/modules/catalog/mappers';
import { ListBillingPlansQueryDto } from '../src/modules/catalog/dtos';

function planFixture(
  input: Partial<{
    amount: string;
    code: string;
    name: string;
    planPriceCode: string;
    paypalPlanId: string | null;
  }> = {},
): BillingPlanEntity {
  const plan = new BillingPlanEntity();
  plan.id = 'plan-id';
  plan.productId = 'product-id';
  plan.code = input.code ?? 'medsync_clinic';
  plan.name = input.name ?? 'Clinica';
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
  price.code = input.planPriceCode ?? 'medsync_clinic_monthly_mxn';
  price.billingInterval = PlanPriceBillingInterval.Month;
  price.billingIntervalCount = 1;
  price.currency = 'MXN';
  price.amount = input.amount ?? '1299.00';
  price.status = PlanPriceStatus.Active;

  const providerPrice = new BillingProviderPriceEntity();
  providerPrice.provider = BillingProvider.Paypal;
  providerPrice.providerPriceId =
    input.paypalPlanId === undefined ? 'paypal-plan-id' : input.paypalPlanId;
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

function catalogServiceFixture(plans: BillingPlanEntity[]) {
  const product = new BillingProductEntity();
  product.id = 'product-id';
  product.code = 'medsync';
  product.name = 'MedSync';
  product.status = BillingProductStatus.Active;

  const products = { findOne: jest.fn().mockResolvedValue(product) };
  const planRepository = {
    find: jest.fn().mockResolvedValue(plans),
    findOne: jest.fn(
      ({
        where,
      }: {
        where: { productId: string; code: string; status: BillingPlanStatus };
      }) =>
        Promise.resolve(
          plans.find(
            (plan) =>
              plan.productId === where.productId &&
              plan.code === where.code &&
              plan.status === where.status,
          ) ?? null,
        ),
    ),
  };
  const noop = {};

  return new BillingCatalogService(
    products as never,
    planRepository as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    new BillingPlanCatalogResolver(),
  );
}

describe('catalog plan model', () => {
  it('paginates beyond the first 100 plans and searches the full product list', async () => {
    const plans = Array.from({ length: 105 }, (_, index) => {
      const plan = planFixture({
        code: 'plan_' + index,
        name: index === 104 ? 'Especial' : 'Regular',
      });
      plan.id = 'plan-id-' + index;
      return plan;
    });
    const service = catalogServiceFixture(plans);
    const query = new ListBillingPlansQueryDto();
    query.product_id = 'product-id';
    query.page = 11;
    query.limit = 10;

    const lastPage = await service.listPlans(query);
    expect(lastPage.total).toBe(105);
    expect(lastPage.items).toHaveLength(5);
    expect(lastPage.items[4].code).toBe('plan_104');

    query.page = 1;
    query.q = 'especial';
    const search = await service.listPlans(query);
    expect(search.total).toBe(1);
    expect(search.items[0].code).toBe('plan_104');
  });

  it('keeps draft plans accessible in the console without exposing them publicly', async () => {
    const draft = planFixture();
    draft.versions![0].status = PlanVersionStatus.Draft;
    const service = catalogServiceFixture([draft]);
    const query = new ListBillingPlansQueryDto();
    query.product_id = 'product-id';

    const consolePlans = await service.listPlans(query);
    expect(consolePlans.total).toBe(1);
    expect(consolePlans.items[0].id).toBe(draft.id);
    expect(consolePlans.items[0].versions[0].status).toBe(
      PlanVersionStatus.Draft,
    );
    expect((await service.listPublicPlansByProduct('medsync')).plans).toEqual(
      [],
    );
  });

  it('maps nested catalog fields from published version data', () => {
    const dto = BillingCatalogMapper.toPlanDto(planFixture());

    expect(dto.versions[0].prices[0].amount).toBe('1299.00');
    expect(dto.versions[0].prices[0].providerPrices[0].providerPriceId).toBe(
      'paypal-plan-id',
    );
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

    expect(() =>
      resolver.resolve(
        plan,
        BillingProvider.Paypal,
        'medsync_clinic_monthly_mxn',
      ),
    ).toThrow('Active provider price not found');
  });

  it('validates entitlement values against feature value type', () => {
    const resolver = new BillingPlanCatalogResolver();

    expect(() =>
      resolver.validateFeatureValue(FeatureValueType.Integer, true),
    ).toThrow(BadRequestException);
  });

  it('aggregates values by strategy', () => {
    const resolver = new BillingPlanCatalogResolver();
    const values: Record<string, unknown> = { seats: 2, handoff: false };

    resolver.aggregate(values, 'seats', 3, FeatureAggregationStrategy.Sum);
    resolver.aggregate(
      values,
      'handoff',
      true,
      FeatureAggregationStrategy.BooleanOr,
    );

    expect(values).toEqual({ seats: 5, handoff: true });
  });

  it('maps public catalog plans without internal ids or provider metadata', async () => {
    const service = catalogServiceFixture([planFixture()]);

    const dto = await service.listPublicPlansByProduct('medsync');
    const serialized = JSON.stringify(dto);

    expect(dto).toEqual({
      productCode: 'medsync',
      plans: [
        {
          code: 'medsync_clinic',
          name: 'Clinica',
          description: null,
          prices: [
            {
              code: 'medsync_clinic_monthly_mxn',
              billingInterval: PlanPriceBillingInterval.Month,
              billingIntervalCount: 1,
              currency: 'MXN',
              amount: '1299.00',
            },
          ],
          features: { 'users.included': 10 },
        },
      ],
    });
    expect(serialized).not.toContain('plan-id');
    expect(serialized).not.toContain('providerPrice');
    expect(serialized).not.toContain('paypal-plan-id');
  });

  it('filters inactive public prices and omits plans without active prices', async () => {
    const visible = planFixture({ code: 'medsync_pro', amount: '999.00' });
    const inactivePrice = new BillingPlanPriceEntity();
    inactivePrice.code = 'medsync_pro_old_mxn';
    inactivePrice.billingInterval = PlanPriceBillingInterval.Month;
    inactivePrice.billingIntervalCount = 1;
    inactivePrice.currency = 'MXN';
    inactivePrice.amount = '1999.00';
    inactivePrice.status = PlanPriceStatus.Archived;
    visible.versions![0].prices!.push(inactivePrice);

    const hidden = planFixture({ code: 'medsync_hidden' });
    hidden.versions![0].prices!.forEach((price) => {
      price.status = PlanPriceStatus.Archived;
    });

    const service = catalogServiceFixture([hidden, visible]);
    const dto = await service.listPublicPlansByProduct('medsync');

    expect(dto.plans.map((plan) => plan.code)).toEqual(['medsync_pro']);
    expect(dto.plans[0].prices.map((price) => price.code)).toEqual([
      'medsync_clinic_monthly_mxn',
    ]);
  });

  it('sorts public plans by first active price amount', async () => {
    const clinic = planFixture({ code: 'medsync_clinic', amount: '1299.00' });
    const basic = planFixture({ code: 'medsync_basic', amount: '499.00' });

    const service = catalogServiceFixture([clinic, basic]);
    const dto = await service.listPublicPlansByProduct('medsync');

    expect(dto.plans.map((plan) => plan.code)).toEqual([
      'medsync_basic',
      'medsync_clinic',
    ]);
  });

  it('returns the public PayPal plan id for an active plan price', async () => {
    const service = catalogServiceFixture([planFixture()]);

    await expect(
      service.getPublicPaypalPlanId(
        'medsync',
        'medsync_clinic',
        'medsync_clinic_monthly_mxn',
      ),
    ).resolves.toEqual({
      productCode: 'medsync',
      planCode: 'medsync_clinic',
      planPriceCode: 'medsync_clinic_monthly_mxn',
      provider: BillingProvider.Paypal,
      paypalPlanId: 'paypal-plan-id',
    });
  });

  it('fails public PayPal plan lookup when price or provider id is missing', async () => {
    const service = catalogServiceFixture([
      planFixture({ paypalPlanId: null }),
    ]);

    await expect(
      service.getPublicPaypalPlanId(
        'medsync',
        'medsync_clinic',
        'missing_price',
      ),
    ).rejects.toThrow('Active billing plan price not found');
    await expect(
      service.getPublicPaypalPlanId(
        'medsync',
        'medsync_clinic',
        'medsync_clinic_monthly_mxn',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
