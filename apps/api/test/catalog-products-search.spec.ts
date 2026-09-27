import { ILike } from 'typeorm';
import {
  AddonStatus,
  BillingProductStatus,
  BillingProvider,
} from '../src/modules/billing-shared';
import { BillingCatalogService } from '../src/modules/catalog';
import {
  ListBillingAddonsQueryDto,
  ListBillingProductsQueryDto,
} from '../src/modules/catalog/dtos';

describe('catalog product search', () => {
  it('searches add-ons before pagination while retaining the product and status filters', async () => {
    const addons = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
    const unused = {} as never;
    const service = new BillingCatalogService(
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      addons as never,
      unused,
      unused,
      unused,
    );
    const query = new ListBillingAddonsQueryDto();
    query.product_id = 'product-id';
    query.status = AddonStatus.Active;
    query.q = 'pay';
    query.page = 11;
    query.limit = 10;

    await service.listAddons(query);

    expect(addons.findAndCount).toHaveBeenCalledWith({
      where: [
        {
          productId: 'product-id',
          status: AddonStatus.Active,
          code: ILike('%pay%'),
        },
        {
          productId: 'product-id',
          status: AddonStatus.Active,
          name: ILike('%pay%'),
        },
        {
          productId: 'product-id',
          status: AddonStatus.Active,
          provider: BillingProvider.Paypal,
        },
      ],
      relations: { product: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: 100,
      take: 10,
    });
  });

  it('filters before pagination across code, name, and description', async () => {
    const products = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
    const unused = {} as never;
    const service = new BillingCatalogService(
      products as never,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
    const query = new ListBillingProductsQueryDto();
    query.q = '  med%_sync  ';
    query.status = BillingProductStatus.Active;
    query.page = 2;

    await service.listProducts(query);

    const pattern = '%med\\%\\_sync%';
    expect(products.findAndCount).toHaveBeenCalledWith({
      where: [
        { status: BillingProductStatus.Active, code: ILike(pattern) },
        { status: BillingProductStatus.Active, name: ILike(pattern) },
        { status: BillingProductStatus.Active, description: ILike(pattern) },
      ],
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: 20,
      take: 20,
    });
  });
});
