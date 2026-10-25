import {
  BillingPlanVersionEntity,
  PlanVersionStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import {
  BillingCatalogService,
  BillingPlanCatalogResolver,
} from '../../../../apps/api/src/modules/catalog';
import { ListPlanVersionSummariesQueryDto } from '../../../../apps/api/src/modules/catalog/dtos';

function countQuery(rows: { versionId: string; count: string }[]) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
}

describe('catalog version summaries', () => {
  it('includes only the published version summary in the plan overview', async () => {
    const plan = {
      id: 'plan-id',
      productId: 'product-id',
      code: 'pro',
      name: 'Pro',
      description: null,
      status: 'active',
    };
    const published = Object.assign(new BillingPlanVersionEntity(), {
      id: 'version-3',
      planId: plan.id,
      version: 3,
      status: PlanVersionStatus.Published,
      effectiveFrom: new Date('2026-09-30T00:00:00Z'),
      effectiveUntil: null,
      createdAt: new Date('2026-09-29T00:00:00Z'),
    });
    const plans = { findOne: jest.fn().mockResolvedValue(plan) };
    const versions = { findOne: jest.fn().mockResolvedValue(published) };
    const prices = { count: jest.fn().mockResolvedValue(2) };
    const entitlements = { count: jest.fn().mockResolvedValue(4) };
    const service = new BillingCatalogService(
      {} as never,
      plans as never,
      versions as never,
      prices as never,
      {} as never,
      {} as never,
      entitlements as never,
      {} as never,
      {} as never,
      {} as never,
      new BillingPlanCatalogResolver(),
    );

    const overview = await service.getPlanOverview(plan.id);

    expect(versions.findOne).toHaveBeenCalledWith({
      where: { planId: plan.id, status: PlanVersionStatus.Published },
      order: { version: 'DESC' },
    });
    expect(prices.count).toHaveBeenCalledWith({
      where: { planVersionId: published.id },
    });
    expect(entitlements.count).toHaveBeenCalledWith({
      where: { planVersionId: published.id },
    });
    expect(overview.publishedVersion).toEqual({
      id: published.id,
      version: 3,
      status: PlanVersionStatus.Published,
      effectiveFrom: published.effectiveFrom,
      effectiveUntil: null,
      createdAt: published.createdAt,
      priceCount: 2,
      entitlementCount: 4,
    });

    versions.findOne.mockResolvedValueOnce(null);
    expect(
      (await service.getPlanOverview(plan.id)).publishedVersion,
    ).toBeNull();
    expect(prices.count).toHaveBeenCalledTimes(1);
  });

  it('paginates lightweight versions and reports price and feature counts', async () => {
    const version = Object.assign(new BillingPlanVersionEntity(), {
      id: 'version-11',
      planId: 'plan-id',
      version: 11,
      status: PlanVersionStatus.Published,
      effectiveFrom: null,
      effectiveUntil: null,
      createdAt: new Date('2026-09-30T00:00:00Z'),
    });
    const versionQuery = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[version], 11]),
    };
    const plans = { findOne: jest.fn().mockResolvedValue({ id: 'plan-id' }) };
    const versions = {
      createQueryBuilder: jest.fn().mockReturnValue(versionQuery),
    };
    const prices = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(countQuery([{ versionId: version.id, count: '2' }])),
    };
    const entitlements = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(countQuery([{ versionId: version.id, count: '3' }])),
    };
    const service = new BillingCatalogService(
      {} as never,
      plans as never,
      versions as never,
      prices as never,
      {} as never,
      {} as never,
      entitlements as never,
      {} as never,
      {} as never,
      {} as never,
      new BillingPlanCatalogResolver(),
    );
    const query = new ListPlanVersionSummariesQueryDto();
    query.page = 2;

    const result = await service.listPlanVersionSummaries('plan-id', query);

    expect(versionQuery.skip).toHaveBeenCalledWith(10);
    expect(versionQuery.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      items: [
        {
          id: version.id,
          version: 11,
          status: PlanVersionStatus.Published,
          effectiveFrom: null,
          effectiveUntil: null,
          createdAt: version.createdAt,
          priceCount: 2,
          entitlementCount: 3,
        },
      ],
      total: 11,
      page: 2,
      limit: 10,
    });
  });

  it('loads full details only for a version belonging to the requested plan', async () => {
    const version = Object.assign(new BillingPlanVersionEntity(), {
      id: 'version-id',
      planId: 'plan-id',
      version: 3,
      status: PlanVersionStatus.Archived,
      effectiveFrom: null,
      effectiveUntil: null,
      prices: [],
      entitlements: [],
    });
    const versions = { findOne: jest.fn().mockResolvedValue(version) };
    const service = new BillingCatalogService(
      {} as never,
      {} as never,
      versions as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new BillingPlanCatalogResolver(),
    );

    expect(await service.getPlanVersion('plan-id', 'version-id')).toEqual({
      id: 'version-id',
      version: 3,
      status: PlanVersionStatus.Archived,
      effectiveFrom: null,
      effectiveUntil: null,
      prices: [],
      entitlements: [],
    });
    expect(versions.findOne).toHaveBeenCalledWith({
      where: { id: 'version-id', planId: 'plan-id' },
      relations: {
        prices: { providerPrices: true },
        entitlements: { feature: true },
      },
    });
  });
});
