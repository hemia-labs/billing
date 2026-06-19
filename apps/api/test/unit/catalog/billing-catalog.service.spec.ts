import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BillingInterval } from 'src/modules/billing-shared';
import {
  AddonStatus,
  BillingAddonType,
  BillingPlanStatus,
  BillingProductStatus,
  BillingProvider,
} from 'src/modules/billing-shared';
import { BillingCatalogService } from 'src/modules/catalog/billing-catalog.service';

const product = {
  id: '4f984178-4f2a-4a63-a157-2406f7f21dc0',
  code: 'medsync',
  name: 'MedSync',
  description: null,
  status: BillingProductStatus.Active,
};

const createRepositoryMock = () => ({
  create: jest.fn((entity) => entity),
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(async (entity) => ({ id: entity.id ?? 'new-id', ...entity })),
});

describe('BillingCatalogService', () => {
  let products: ReturnType<typeof createRepositoryMock>;
  let plans: ReturnType<typeof createRepositoryMock>;
  let addons: ReturnType<typeof createRepositoryMock>;
  let service: BillingCatalogService;

  beforeEach(() => {
    products = createRepositoryMock();
    plans = createRepositoryMock();
    addons = createRepositoryMock();
    service = new BillingCatalogService(products as never, plans as never, addons as never);
  });

  it('lists only active plans for an active product', async () => {
    products.findOne.mockResolvedValue(product);
    plans.find.mockResolvedValue([
      {
        id: 'plan-id',
        productId: product.id,
        product,
        code: 'medsync_pro_monthly',
        provider: BillingProvider.Paypal,
        providerPlanId: null,
        name: 'Profesional',
        billingInterval: BillingInterval.Monthly,
        currency: 'MXN',
        amount: '999.00',
        seatsIncluded: 5,
        featuresJson: {},
        status: BillingPlanStatus.Active,
      },
    ]);

    const result = await service.listActivePlansByProduct('medsync');

    expect(plans.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: product.id, status: BillingPlanStatus.Active },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('medsync_pro_monthly');
  });

  it('lists only active add-ons for an active product', async () => {
    products.findOne.mockResolvedValue(product);
    addons.find.mockResolvedValue([
      {
        id: 'addon-id',
        productId: product.id,
        productCode: product.code,
        code: 'extra_user',
        name: 'Usuario extra',
        description: null,
        unitPrice: '99.00',
        currency: 'MXN',
        billingInterval: BillingInterval.Monthly,
        type: BillingAddonType.Recurring,
        status: AddonStatus.Active,
        metadata: {},
      },
    ]);

    const result = await service.listActiveAddonsByProduct('medsync');

    expect(addons.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productId: product.id,
          productCode: product.code,
          status: AddonStatus.Active,
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('extra_user');
  });

  it('throws conflict when product code already exists', async () => {
    products.findOne.mockResolvedValue(product);

    await expect(
      service.createProduct({ code: 'medsync', name: 'MedSync' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws not found when creating a plan for a missing product', async () => {
    products.findOne.mockResolvedValue(null);

    await expect(
      service.createPlan({
        productCode: 'missing',
        code: 'missing_monthly',
        provider: BillingProvider.Paypal,
        name: 'Missing',
        billingInterval: BillingInterval.Monthly,
        currency: 'MXN',
        amount: '1.00',
        seatsIncluded: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws conflict when add-on code already exists for product', async () => {
    products.findOne.mockResolvedValue(product);
    addons.findOne.mockResolvedValue({ id: 'addon-id' });

    await expect(
      service.createAddon({
        productCode: 'medsync',
        code: 'extra_user',
        name: 'Usuario extra',
        unitPrice: '99.00',
        currency: 'MXN',
        billingInterval: BillingInterval.Monthly,
        type: BillingAddonType.Recurring,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws bad request when product id and code are missing', async () => {
    await expect(
      service.createAddon({
        code: 'extra_user',
        name: 'Usuario extra',
        unitPrice: '99.00',
        currency: 'MXN',
        billingInterval: BillingInterval.Monthly,
        type: BillingAddonType.Recurring,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
