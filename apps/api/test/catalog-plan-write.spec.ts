import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  BillingFeatureDefinitionEntity,
  BillingPlanEntity,
  BillingPlanEntitlementEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProductEntity,
  BillingProviderPriceEntity,
  BillingProvider,
  FeatureValueType,
  PlanPriceBillingInterval,
} from '../src/modules/billing-shared';
import {
  BillingCatalogService,
  BillingPlanCatalogResolver,
} from '../src/modules/catalog';
import {
  CreateBillingPlanDto,
  CreatePlanPriceDto,
} from '../src/modules/catalog/dtos';

describe('catalog plan writes', () => {
  it.each(['0', '0.00', '1.2', '9999999999.99'])(
    'accepts a DECIMAL(12,2) amount: %s',
    (amount) => {
      const dto = plainToInstance(CreatePlanPriceDto, {
        code: 'monthly',
        billingInterval: PlanPriceBillingInterval.Month,
        billingIntervalCount: 1,
        currency: 'MXN',
        amount,
        providerPrices: [],
      });
      expect(
        validateSync(dto).find((error) => error.property === 'amount'),
      ).toBeUndefined();
    },
  );

  it.each([
    '',
    '-1.00',
    'abc',
    '1e3',
    '1.234',
    '10000000000.00',
    ' 1.00',
    '01.00',
  ])('rejects an invalid amount: %s', (amount) => {
    const dto = plainToInstance(CreatePlanPriceDto, {
      code: 'monthly',
      billingInterval: PlanPriceBillingInterval.Month,
      billingIntervalCount: 1,
      currency: 'MXN',
      amount,
      providerPrices: [],
    });
    expect(validateSync(dto).some((error) => error.property === 'amount')).toBe(
      true,
    );
  });

  it('rolls back plan, feature, version, price and provider when an entitlement fails', async () => {
    const committed: string[] = [];
    const staged: string[] = [];
    const repository = (name: string, writes: string[]) => ({
      create: jest.fn((item: object) => item),
      save: jest.fn((item: object) => {
        writes.push(name);
        return Promise.resolve({ id: `${name}-${writes.length}`, ...item });
      }),
      findOne: jest.fn(() => Promise.resolve(null)),
    });
    const products = {
      findOne: jest.fn(() => {
        const product = new BillingProductEntity();
        product.id = 'product-id';
        return Promise.resolve(product);
      }),
    };
    const plans = repository('plan', committed);
    const versions = repository('version', committed);
    const prices = repository('price', committed);
    const providerPrices = repository('provider', committed);
    const features = repository('feature', committed);
    const entitlements = repository('entitlement', committed);

    const transactionRepositories = new Map<
      unknown,
      ReturnType<typeof repository>
    >([
      [BillingPlanEntity, repository('plan', staged)],
      [BillingPlanVersionEntity, repository('version', staged)],
      [BillingPlanPriceEntity, repository('price', staged)],
      [BillingProviderPriceEntity, repository('provider', staged)],
      [BillingFeatureDefinitionEntity, repository('feature', staged)],
      [BillingPlanEntitlementEntity, repository('entitlement', staged)],
    ]);
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        transactionRepositories.get(entity),
      ),
      transaction: jest.fn(
        async (operation: (value: unknown) => Promise<unknown>) => {
          const result = await operation(manager);
          committed.push(...staged);
          return result;
        },
      ),
    };
    const service = new BillingCatalogService(
      products as never,
      { ...plans, manager } as never,
      { ...versions, manager } as never,
      prices as never,
      providerPrices as never,
      features as never,
      entitlements as never,
      {} as never,
      {} as never,
      {} as never,
      new BillingPlanCatalogResolver(),
    );
    const dto = plainToInstance(CreateBillingPlanDto, {
      productId: 'product-id',
      code: 'pro',
      name: 'Pro',
      features: [
        { code: 'valid', name: 'Valid', valueType: FeatureValueType.Integer },
      ],
      version: {
        version: 1,
        prices: [
          {
            code: 'monthly',
            billingInterval: PlanPriceBillingInterval.Month,
            billingIntervalCount: 1,
            currency: 'MXN',
            amount: '10.00',
            providerPrices: [
              {
                provider: BillingProvider.Paypal,
                providerPriceId: 'paypal-id',
              },
            ],
          },
        ],
        entitlements: [{ featureCode: 'missing', valueJson: 1 }],
      },
    });

    await expect(service.createPlan(dto)).rejects.toThrow(
      'Billing feature definition not found',
    );
    expect(staged).toEqual(['plan', 'feature', 'version', 'price', 'provider']);
    expect(committed).toEqual([]);
    expect(manager.transaction).toHaveBeenCalledTimes(1);
  });
});
