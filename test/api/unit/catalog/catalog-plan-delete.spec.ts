import { ConflictException, NotFoundException } from '@nestjs/common';
import { BillingCatalogService } from '../../../../apps/api/src/modules/catalog/billing-catalog.service';
import {
  BillingPlanEntity,
  BillingPlanVersionEntity,
} from '../../../../apps/api/src/modules/billing-shared';

function fixture() {
  const plan = { id: 'plan', productId: 'product', code: 'basic' };
  const plans = {
    findOne: jest.fn().mockResolvedValue(plan),
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    save: jest.fn(),
  };
  const versions = {
    findOneBy: jest.fn().mockResolvedValue({ id: 'version', planId: plan.id }),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const transaction = jest.fn();
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === BillingPlanVersionEntity ? versions : plans,
    ),
    query: jest.fn().mockResolvedValue([{ used: false }]),
    transaction,
  };
  transaction.mockImplementation((run: (m: unknown) => Promise<void>) =>
    run(manager),
  );
  const service = new BillingCatalogService(
    {} as never,
    { ...plans, manager } as never,
    { ...versions, manager } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { resolveConnection: () => Promise.resolve(null) } as never,
  );
  return { service, plans, versions, manager, plan };
}

describe('catalog plan deletion', () => {
  it('soft deletes an unused plan while holding its row lock', async () => {
    const f = fixture();
    await expect(f.service.deletePlan(f.plan.id)).resolves.toBeUndefined();
    expect(f.manager.transaction).toHaveBeenCalledTimes(1);
    expect(f.manager.getRepository).toHaveBeenCalledWith(BillingPlanEntity);
    expect(f.plans.findOne).toHaveBeenCalledWith({
      where: { id: f.plan.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(f.manager.query.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.plans.findOne.mock.invocationCallOrder[0],
    );
    expect(f.plans.softDelete).toHaveBeenCalledWith(f.plan.id);
    expect(f.plans.softDelete.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.manager.query.mock.invocationCallOrder[0],
    );
  });

  it('rejects references including historical contracts and pending payments', async () => {
    const f = fixture();
    f.manager.query.mockResolvedValue([{ used: true }]);
    await expect(f.service.deletePlan(f.plan.id)).rejects.toThrow(
      ConflictException,
    );
    expect(f.plans.softDelete).not.toHaveBeenCalled();
  });

  it('returns not found for an absent or already deleted plan', async () => {
    const f = fixture();
    f.plans.findOne.mockResolvedValue(null);
    await expect(f.service.deletePlan(f.plan.id)).rejects.toThrow(
      NotFoundException,
    );
    expect(f.manager.query).not.toHaveBeenCalled();
    expect(f.plans.softDelete).not.toHaveBeenCalled();
  });

  it('does not save a stale plan that was deleted before its update transaction', async () => {
    const f = fixture();
    const stale = { ...f.plan, product: { id: 'product' }, deletedAt: null };
    f.plans.findOne.mockResolvedValueOnce(stale).mockResolvedValueOnce(null);
    await expect(
      f.service.updatePlan(f.plan.id, { name: 'Renamed' }),
    ).rejects.toThrow(NotFoundException);
    expect(f.plans.save).not.toHaveBeenCalled();
  });
  it.each(['create', 'update', 'publish'])(
    'rejects %s version after its parent was deleted',
    async (operation) => {
      const f = fixture();
      f.plans.findOne.mockResolvedValue(null);
      const mutation =
        operation === 'create'
          ? f.service.createVersion(f.plan.id, { version: 2, prices: [] })
          : operation === 'update'
            ? f.service.updateVersion('version', {})
            : f.service.publishVersion('version');
      await expect(mutation).rejects.toThrow(NotFoundException);
      expect(f.versions.findOne).not.toHaveBeenCalled();
      expect(f.versions.save).not.toHaveBeenCalled();
      expect(f.versions.update).not.toHaveBeenCalled();
    },
  );
});
