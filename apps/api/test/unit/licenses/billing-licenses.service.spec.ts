import { In } from 'typeorm';
import { BillingLicenseEntity } from 'src/modules/billing-shared';
import { LicenseStatus } from 'src/modules/billing-shared';
import { BillingLicensesService } from 'src/modules/licenses/billing-licenses.service';

const createRepositoryMock = () => ({
  findOne: jest.fn(),
});

const license = (
  overrides: Partial<BillingLicenseEntity> = {},
): BillingLicenseEntity =>
  ({
    id: 'license-id',
    organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
    productId: 'product-id',
    productCode: 'medsync',
    subscriptionId: 'subscription-id',
    planCode: 'medsync_pro_monthly',
    status: LicenseStatus.Active,
    seatsLimit: 5,
    usageLimit: null,
    featuresJson: { users: 5 },
    validUntil: new Date('2026-07-18T00:00:00Z'),
    updatedAt: new Date('2026-06-18T00:00:00Z'),
    ...overrides,
  }) as BillingLicenseEntity;

describe('BillingLicensesService', () => {
  let repository: ReturnType<typeof createRepositoryMock>;
  let entitlements: {
    resolveForSubscription: jest.Mock;
    emptyResolution: jest.Mock;
  };
  let service: BillingLicensesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-18T00:00:00Z'));
    repository = createRepositoryMock();
    entitlements = {
      resolveForSubscription: jest.fn().mockResolvedValue({
        entitlements: {
          maxUsers: 8,
          includedUsers: 5,
          extraUsers: 3,
          maxAgents: 3,
          maxConversationsMonthly: 5000,
        },
        billing: {
          baseMonthly: '999.00',
          addonsMonthly: '297.00',
          totalMonthly: '1296.00',
          currency: 'MXN',
        },
      }),
      emptyResolution: jest.fn().mockReturnValue({
        entitlements: {
          maxUsers: 0,
          includedUsers: 0,
          extraUsers: 0,
          maxAgents: 0,
          maxConversationsMonthly: null,
        },
        billing: {
          baseMonthly: '0.00',
          addonsMonthly: '0.00',
          totalMonthly: '0.00',
          currency: 'MXN',
        },
      }),
    };
    service = new BillingLicensesService(repository as never, entitlements as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves active license with limits and features', async () => {
    repository.findOne.mockResolvedValueOnce(license());

    await expect(
      service.resolveLicense(
        '6dfce2ed-9704-43c5-9a40-9c03a047d653',
        'medsync',
      ),
    ).resolves.toEqual({
      active: true,
      productCode: 'medsync',
      planCode: 'medsync_pro_monthly',
      licenseStatus: LicenseStatus.Active,
      validUntil: '2026-07-18T00:00:00.000Z',
      seatsLimit: 8,
      usageLimit: 5000,
      features: { users: 5 },
      subscriptionId: 'subscription-id',
      entitlements: {
        maxUsers: 8,
        includedUsers: 5,
        extraUsers: 3,
        maxAgents: 3,
        maxConversationsMonthly: 5000,
      },
      billing: {
        baseMonthly: '999.00',
        addonsMonthly: '297.00',
        totalMonthly: '1296.00',
        currency: 'MXN',
      },
    });
  });

  it('resolves valid grace license as active', async () => {
    repository.findOne.mockResolvedValueOnce(
      license({
        status: LicenseStatus.Grace,
        validUntil: new Date('2026-06-25T00:00:00Z'),
      }),
    );

    const result = await service.resolveLicense(
      '6dfce2ed-9704-43c5-9a40-9c03a047d653',
      'medsync',
    );

    expect(result.active).toBe(true);
    expect(result.licenseStatus).toBe(LicenseStatus.Grace);
  });

  it('marks expired grace license inactive', async () => {
    repository.findOne.mockResolvedValueOnce(
      license({
        status: LicenseStatus.Grace,
        validUntil: new Date('2026-06-17T00:00:00Z'),
      }),
    );

    const result = await service.resolveLicense(
      '6dfce2ed-9704-43c5-9a40-9c03a047d653',
      'medsync',
    );

    expect(result.active).toBe(false);
  });

  it.each([LicenseStatus.Suspended, LicenseStatus.Revoked])(
    'marks %s license inactive',
    async (status) => {
      repository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(license({ status }));

      const result = await service.resolveLicense(
        '6dfce2ed-9704-43c5-9a40-9c03a047d653',
        'medsync',
      );

      expect(result.active).toBe(false);
      expect(result.licenseStatus).toBe(status);
    },
  );

  it('returns inactive fallback when no license exists', async () => {
    repository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(
      service.resolveLicense(
        '6dfce2ed-9704-43c5-9a40-9c03a047d653',
        'medsync',
      ),
    ).resolves.toEqual({
      active: false,
      productCode: 'medsync',
      planCode: null,
      licenseStatus: LicenseStatus.Revoked,
      validUntil: null,
      seatsLimit: 0,
      usageLimit: null,
      features: {},
      subscriptionId: null,
      entitlements: {
        maxUsers: 0,
        includedUsers: 0,
        extraUsers: 0,
        maxAgents: 0,
        maxConversationsMonthly: null,
      },
      billing: {
        baseMonthly: '0.00',
        addonsMonthly: '0.00',
        totalMonthly: '0.00',
        currency: 'MXN',
      },
    });
  });

  it('prioritizes active or grace licenses ordered by latest update', async () => {
    repository.findOne.mockResolvedValueOnce(license({ id: 'active-license' }));

    await service.resolveLicense(
      '6dfce2ed-9704-43c5-9a40-9c03a047d653',
      'medsync',
    );

    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
        productCode: 'medsync',
        status: In([LicenseStatus.Active, LicenseStatus.Grace]),
      },
      relations: { product: true, subscription: { plan: true } },
      order: { updatedAt: 'DESC' },
    });
  });
});
