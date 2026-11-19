import {
  BillingAddonEntity,
  BillingPlanPriceEntity,
  BillingProvider,
} from '../../../../apps/api/src/modules/billing-shared';
const repository = {
  existsBy: jest.fn(),
  save: jest.fn((value: unknown) => Promise.resolve(value)),
  create: jest.fn((value: unknown) => value),
};
jest.mock('../../../../apps/api/data-source', () => ({
  AppDataSource: {
    getRepository: () => repository,
    initialize: jest.fn(() => {
      throw new Error('Seed must not run on import');
    }),
  },
}));
import {
  seedProviderPrice,
  seedAddonProviderPrice,
} from '../../../../apps/api/src/database/seeds/billing-catalog.seed';
describe('catalog seed preserves connection-specific remote IDs', () => {
  const original = process.env.PAYPAL_MEDSYNC_BASIC_PLAN_ID;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYPAL_MEDSYNC_BASIC_PLAN_ID = 'P-ENV-OTHER-APP';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.PAYPAL_MEDSYNC_BASIC_PLAN_ID;
    else process.env.PAYPAL_MEDSYNC_BASIC_PLAN_ID = original;
  });
  it('never overwrites existing A/B mappings when the environment changes', async () => {
    const mappings = [
      {
        planPriceId: 'price',
        provider: BillingProvider.Paypal,
        providerConnectionId: 'app-a',
        providerPriceId: 'P-A',
      },
      {
        planPriceId: 'price',
        provider: BillingProvider.Paypal,
        providerConnectionId: 'app-b',
        providerPriceId: 'P-B',
      },
      {
        addonId: 'addon',
        provider: BillingProvider.Paypal,
        providerConnectionId: 'app-a',
        providerPriceId: 'P-ADDON-A',
      },
      {
        addonId: 'addon',
        provider: BillingProvider.Paypal,
        providerConnectionId: 'app-b',
        providerPriceId: 'P-ADDON-B',
      },
    ];
    const before = JSON.stringify(mappings);
    repository.existsBy.mockImplementation((where: Record<string, unknown>) =>
      Promise.resolve(
        mappings.some((mapping) =>
          Object.entries(where).every(
            ([key, value]) =>
              (mapping as Record<string, unknown>)[key] === value,
          ),
        ),
      ),
    );
    await seedProviderPrice(
      Object.assign(new BillingPlanPriceEntity(), { id: 'price' }),
      'medsync_basic',
    );
    await seedAddonProviderPrice(
      Object.assign(new BillingAddonEntity(), {
        id: 'addon',
        provider: BillingProvider.Paypal,
        providerPlanId: 'P-OLD-LEGACY',
      }),
    );
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(JSON.stringify(mappings)).toBe(before);
  });
  it('creates an unassigned mapping and never guesses the app or global scope', async () => {
    repository.existsBy.mockResolvedValue(false);
    await seedProviderPrice(
      Object.assign(new BillingPlanPriceEntity(), { id: 'price' }),
      'medsync_basic',
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPriceId: 'P-ENV-OTHER-APP',
        connectionScope: 'unassigned',
        providerConnectionId: null,
      }),
    );
  });
});
