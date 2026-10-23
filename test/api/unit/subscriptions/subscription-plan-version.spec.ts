import {
  BillingEntitlementEntity,
  BillingFeatureDefinitionEntity,
  BillingPlanEntitlementEntity,
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
  EntitlementStatus,
  LicenseStatus,
  PlanPriceBillingInterval,
  PlanPriceStatus,
  PlanVersionStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import {
  BillingCatalogService,
  BillingPlanCatalogResolver,
} from '../../../../apps/api/src/modules/catalog';
import { BillingEntitlementsService } from '../../../../apps/api/src/modules/entitlements';
import { BillingLicenseCalculatorService } from '../../../../apps/api/src/modules/licenses';

function contractFixture() {
  const plan = new BillingPlanEntity();
  plan.id = 'plan-id';

  const makeVersion = (
    id: string,
    number: number,
    status: PlanVersionStatus,
    users: number,
    reports: boolean,
    amount: string,
  ) => {
    const version = new BillingPlanVersionEntity();
    version.id = id;
    version.version = number;
    version.status = status;
    version.planId = plan.id;

    const price = new BillingPlanPriceEntity();
    price.id = `${id}-price`;
    price.planVersionId = id;
    price.code = 'monthly_mxn';
    price.status = PlanPriceStatus.Active;
    price.billingInterval = PlanPriceBillingInterval.Month;
    price.billingIntervalCount = 1;
    price.currency = 'MXN';
    price.amount = amount;
    version.prices = [price];
    version.entitlements = [
      ['users.included', users],
      ['reports.enabled', reports],
    ].map(([code, value]) => {
      const feature = new BillingFeatureDefinitionEntity();
      feature.code = String(code);
      const entitlement = new BillingPlanEntitlementEntity();
      entitlement.feature = feature;
      entitlement.valueJson = value;
      return entitlement;
    });
    return version;
  };

  const contracted = makeVersion(
    'v1',
    1,
    PlanVersionStatus.Archived,
    10,
    true,
    '10.00',
  );
  const latest = makeVersion(
    'v2',
    2,
    PlanVersionStatus.Published,
    25,
    false,
    '25.00',
  );
  plan.versions = [contracted, latest];

  const subscription = new BillingSubscriptionEntity();
  subscription.id = 'subscription-id';
  subscription.organizationId = 'organization-id';
  subscription.productCode = 'product';
  subscription.planCode = 'basic';
  subscription.planId = plan.id;
  subscription.plan = plan;
  subscription.planPriceId = contracted.prices![0].id;
  subscription.planPrice = null;
  subscription.providerPriceId = null;
  subscription.providerPrice = null;
  subscription.planPriceCode = contracted.prices![0].code;

  return { contracted, latest, subscription };
}

describe('contracted plan version', () => {
  it('keeps archived terms for license and billing calculations after a new publication', async () => {
    const { contracted, subscription } = contractFixture();
    const resolver = new BillingPlanCatalogResolver();
    expect(resolver.contractVersion(subscription).id).toBe(contracted.id);

    const product = new BillingProductEntity();
    product.id = 'product-id';
    const license = new BillingLicenseCalculatorService(resolver).calculate({
      product,
      subscription,
      status: LicenseStatus.Active,
    });
    expect(license.seatsLimit).toBe(10);
    expect(license.featuresJson['reports.enabled']).toBe(true);

    const stored = new Map<string, BillingEntitlementEntity>();
    const entitlements = {
      find: jest.fn(() => Promise.resolve([...stored.values()])),
      findOne: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(stored.get(where.key) ?? null),
      ),
      create: jest.fn((value: Partial<BillingEntitlementEntity>) =>
        Object.assign(new BillingEntitlementEntity(), value),
      ),
      save: jest.fn((value: BillingEntitlementEntity) => {
        stored.set(value.key, value);
        return Promise.resolve(value);
      }),
    };
    const service = new BillingEntitlementsService(
      { findOne: jest.fn(() => Promise.resolve(subscription)) } as never,
      { find: jest.fn(() => Promise.resolve([])) } as never,
      entitlements as never,
      { record: jest.fn(() => Promise.resolve()) } as never,
      resolver,
    );

    const calculated = await service.recalculate(subscription.id);
    expect(calculated.entitlements.includedUsers).toBe(10);
    expect(calculated.entitlements.featureFlags['reports.enabled']).toBe(true);
    expect(calculated.billing.baseMonthly).toBe('10.00');
    expect(stored.get('included_users')?.metadata.planVersionId).toBe(
      contracted.id,
    );

    for (const entitlement of stored.values()) {
      entitlement.metadata = { planVersionId: 'v2' };
      if (entitlement.key === 'included_users') entitlement.value = 25;
    }
    const restored = await service.resolveForSubscription(subscription.id);
    expect(restored.entitlements.includedUsers).toBe(10);
    expect(restored.entitlements.featureFlags['reports.enabled']).toBe(true);
    expect(stored.get('included_users')?.metadata.planVersionId).toBe(
      contracted.id,
    );
    expect(stored.get('included_users')?.status).toBe(EntitlementStatus.Active);
  });

  it('blocks publication while a live contract has no pinned price', async () => {
    const version = new BillingPlanVersionEntity();
    version.id = 'draft-version';
    version.planId = 'plan-id';
    version.status = PlanVersionStatus.Draft;
    const versionRepository = {
      findOneBy: jest.fn(() => Promise.resolve(version)),
      findOne: jest.fn(() => Promise.resolve(version)),
      update: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === BillingPlanVersionEntity) return versionRepository;
        if (entity === BillingPlanEntity) {
          return {
            findOne: jest.fn(() => Promise.resolve({ id: version.planId })),
          };
        }
        if (entity === BillingSubscriptionEntity) {
          return {
            findOne: jest.fn(() => Promise.resolve({ id: 'unpinned' })),
          };
        }
        throw new Error('Unexpected repository');
      }),
    };
    const transaction = jest.fn(
      (callback: (input: typeof manager) => Promise<unknown>) =>
        callback(manager),
    );
    const unused = {} as never;
    const service = new BillingCatalogService(
      unused,
      unused,
      { manager: { transaction } } as never,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      new BillingPlanCatalogResolver(),
    );

    await expect(service.publishVersion(version.id)).rejects.toThrow(
      'Live subscriptions must have a pinned price before publishing',
    );
    expect(versionRepository.update).not.toHaveBeenCalled();
  });

  it('fails instead of silently switching to the latest version if the contracted price is missing', () => {
    const { subscription } = contractFixture();
    subscription.planPriceId = 'missing-price';
    expect(() =>
      new BillingPlanCatalogResolver().contractVersion(subscription),
    ).toThrow('Contracted billing plan version not found');
  });
});
