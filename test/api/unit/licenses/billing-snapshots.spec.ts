import { BillingSnapshotsService } from '../../../../apps/api/src/modules/licenses/billing-snapshots.service';
import { SubscriptionStatus } from '../../../../apps/api/src/modules/billing-shared';

function fixture(rows: unknown[] = []) {
  const calls: string[] = [];
  const runner = {
    isTransactionActive: false,
    connect: jest.fn(() => {
      calls.push('connect');
      return Promise.resolve();
    }),
    query: jest.fn((sql: string, params: unknown[] = []) => {
      void params;
      calls.push(sql);
      return Promise.resolve(
        sql.includes('nextval')
          ? [
              {
                revision: '9007199254740993',
                confirmedAt: new Date('2026-10-23T12:00:00Z'),
              },
            ]
          : [],
      );
    }),
    startTransaction: jest.fn(() => {
      calls.push('begin');
      runner.isTransactionActive = true;
      return Promise.resolve();
    }),
    commitTransaction: jest.fn(() => {
      calls.push('commit');
      runner.isTransactionActive = false;
      return Promise.resolve();
    }),
    rollbackTransaction: jest.fn(() => {
      calls.push('rollback');
      runner.isTransactionActive = false;
      return Promise.resolve();
    }),
    release: jest.fn(() => {
      calls.push('release');
      return Promise.resolve();
    }),
    manager: {
      getRepository: jest.fn(() => ({
        find: jest.fn(() => Promise.resolve(rows)),
      })),
    },
  };
  const license = {
    active: false,
    productCode: 'product',
    subscriptionId: null,
  };
  const licenses = { resolveLicense: jest.fn(() => Promise.resolve(license)) };
  return {
    runner,
    licenses,
    calls,
    service: new BillingSnapshotsService(
      { createQueryRunner: () => runner } as never,
      licenses as never,
    ),
  };
}

describe('central optional subscription snapshots', () => {
  it('locks before opening the repeatable read snapshot and shares its manager with all license reads', async () => {
    const f = fixture();
    const result = await f.service.current('organization', 'product');
    expect(result).toMatchObject({
      organizationId: 'organization',
      productCode: 'product',
      revision: '9007199254740993',
      confirmedAt: '2026-10-23T12:00:00.000Z',
      subscription: null,
      license: { active: false },
    });
    expect(f.calls[1]).toContain('pg_advisory_lock(');
    expect(f.calls[2]).toBe('begin');
    expect(f.runner.startTransaction).toHaveBeenCalledWith('REPEATABLE READ');
    expect(f.licenses.resolveLicense).toHaveBeenCalledWith(
      'organization',
      'product',
      f.runner.manager,
    );
    expect(f.calls.slice(-3)[0]).toBe('commit');
    expect(f.calls.at(-2)).toContain('pg_advisory_unlock(');
    expect(f.calls.at(-1)).toBe('release');
  });
  it('releases its session lock and connection after a failed snapshot, without producing a success revision', async () => {
    const f = fixture();
    f.licenses.resolveLicense.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(f.service.current('organization', 'product')).rejects.toThrow(
      'database unavailable',
    );
    expect(f.runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(f.runner.commitTransaction).not.toHaveBeenCalled();
    expect(f.calls.at(-2)).toContain('pg_advisory_unlock(');
    expect(f.runner.release).toHaveBeenCalledTimes(1);
  });
  it('does not expose expired cancellations or internal provider credentials', async () => {
    const f = fixture([
      {
        id: 'old',
        status: SubscriptionStatus.Cancelled,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(0),
        metadata: {},
        updatedAt: new Date(),
      },
      {
        id: 'current',
        status: SubscriptionStatus.Active,
        organizationId: 'organization',
        productCode: 'product',
        planCode: 'pro',
        planPriceCode: 'monthly',
        nextBillingTime: new Date('2030-01-01'),
        currentPeriodEnd: new Date('2030-01-01'),
        cancelAtPeriodEnd: false,
        metadata: {},
        updatedAt: new Date(),
        providerSubscriptionId: 'private-provider-id',
      },
    ]);
    const result = await f.service.current('organization', 'product');
    expect(result.subscription).toMatchObject({
      id: 'current',
      planCode: 'pro',
      pendingPlanChange: null,
      cancellation: null,
    });
    expect(result.subscription).not.toHaveProperty('providerSubscriptionId');
  });
  it('pairs the snapshot with the licensed contract when another contract has a higher status priority', async () => {
    const base = {
      organizationId: 'organization',
      productCode: 'product',
      planCode: 'pro',
      planPriceCode: 'monthly',
      currentPeriodEnd: new Date('2030-01-01'),
      nextBillingTime: null,
      cancelAtPeriodEnd: true,
      metadata: {},
      updatedAt: new Date(),
    };
    const f = fixture([
      { ...base, id: 'new-contract', status: SubscriptionStatus.Active },
      { ...base, id: 'paid-contract', status: SubscriptionStatus.Cancelled },
    ]);
    f.licenses.resolveLicense.mockResolvedValueOnce({
      active: true,
      productCode: 'product',
      subscriptionId: 'paid-contract',
    } as never);
    expect(
      (await f.service.current('organization', 'product')).subscription?.id,
    ).toBe('paid-contract');
  });
  it.each([
    'https://www.sandbox.paypal.com/approve',
    'https://attacker.test/pay',
  ])(
    'never copies buyer approval links into organization snapshots: %s',
    async (paymentApprovalUrl) => {
      const change = {
        state: 'awaiting_approval',
        checkoutId: 'checkout',
        targetPlanCode: 'pro',
        targetPlanPriceCode: 'monthly',
        effectiveAt: '2030-01-01T00:00:00.000Z',
        approvedAt: '2026-10-23T12:00:00.000Z',
        paymentApprovalUrl,
        quote: {
          kind: 'upgrade',
          amountDueNow: '10.00',
          currency: 'MXN',
          recurringAmount: '100.00',
          nextBillingAt: '2030-01-01T00:00:00.000Z',
          effectiveAt: '2026-10-23T12:00:00.000Z',
        },
      };
      const row = {
        id: 'current',
        status: SubscriptionStatus.Active,
        planCode: 'basic',
        planPriceCode: 'monthly',
        metadata: { pendingPlanChange: change },
        updatedAt: new Date(),
      };
      const f = fixture([row]);
      const result = await f.service.current('organization', 'product');
      expect(result.subscription?.pendingPlanChange).toMatchObject({
        state: 'awaiting_approval',
        action: 'approve_payment',
        checkoutUrl: null,
        amountDueNow: '10.00',
        currency: 'MXN',
        targetPlanCode: 'pro',
        checkoutId: 'checkout',
      });
      expect(JSON.stringify(result)).not.toContain(paymentApprovalUrl);
      expect(row.metadata.pendingPlanChange.paymentApprovalUrl).toBe(
        paymentApprovalUrl,
      );
      expect(f.runner.commitTransaction).toHaveBeenCalledTimes(1);
    },
  );
  it('uses the same advisory lock and snapshot identity for uppercase and lowercase organization UUIDs', async () => {
    const f = fixture();
    const organizationId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    const upper = await f.service.current(organizationId, 'product');
    const lower = await f.service.current(
      organizationId.toLowerCase(),
      'product',
    );
    expect(upper.organizationId).toBe(lower.organizationId);
    const locks = f.runner.query.mock.calls.filter(([sql]) =>
      sql.includes('pg_advisory_lock('),
    );
    expect(locks).toHaveLength(2);
    expect(locks[0][1]).toEqual(locks[1][1]);
    expect(f.licenses.resolveLicense).toHaveBeenCalledWith(
      organizationId.toLowerCase(),
      'product',
      f.runner.manager,
    );
  });
});

it('omits failed plan changes from snapshots while retaining their audit metadata', async () => {
  const change = {
    state: 'failed',
    checkoutId: 'old-checkout',
    effectiveAt: '2030-01-01T00:00:00Z',
  };
  const row = {
    id: 'current',
    status: SubscriptionStatus.Active,
    metadata: { pendingPlanChange: change },
    updatedAt: new Date(),
  };
  const f = fixture([row]);
  expect(
    (await f.service.current('organization', 'product')).subscription
      ?.pendingPlanChange,
  ).toBeNull();
  expect(row.metadata.pendingPlanChange).toBe(change);
});
