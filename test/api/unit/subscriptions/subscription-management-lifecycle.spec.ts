import { AsyncLocalStorage } from 'node:async_hooks';
import { BillingCheckoutService } from '../../../../apps/api/src/modules/checkout/billing-checkout.service';
import { BillingSubscriptionsManagementService } from '../../../../apps/api/src/modules/subscriptions-management/billing-subscriptions-management.service';
import { BillingPlanCatalogResolver } from '../../../../apps/api/src/modules/catalog';
import { BillingLicenseCalculatorService } from '../../../../apps/api/src/modules/licenses';
import {
  BillingCheckoutSessionEntity,
  BillingCheckoutSessionStatus,
  BillingLicenseEntity,
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingProviderPriceEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
  BillingProvider,
  BillingPlanStatus,
  LicenseStatus,
  PlanPriceBillingInterval,
  PlanPriceStatus,
  PlanVersionStatus,
  ProviderPriceStatus,
  SubscriptionStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import { applyConfirmedPlanChange } from '../../../../apps/api/src/modules/subscriptions-management/subscription-management-state';

const boundary = '2030-02-01T00:00:00.000Z';
const actor = {
  issuer: 'https://identity.example',
  clientId: 'balanz-service',
};
const cancelDto = {
  idempotencyKey: 'cancel-key',
  actorUserId: 'buyer',
  reason: 'Not needed',
};
const changeDto = {
  idempotencyKey: 'change-key',
  actorUserId: 'buyer',
  targetPlanCode: 'pro',
  targetPlanPriceCode: 'pro-monthly',
  successUrl: 'https://balanz.example/success',
  cancelUrl: 'https://balanz.example/cancel',
};
function catalog(code: string) {
  const provider = Object.assign(new BillingProviderPriceEntity(), {
    id: code + '-provider',
    planPriceId: code + '-price',
    provider: BillingProvider.Paypal,
    providerPriceId: 'P-' + code,
    providerMetadata: {},
    status: ProviderPriceStatus.Active,
  });
  const price = Object.assign(new BillingPlanPriceEntity(), {
    id: code + '-price',
    code: code + '-monthly',
    amount: '499.00',
    currency: 'MXN',
    billingInterval: PlanPriceBillingInterval.Month,
    billingIntervalCount: 1,
    status: PlanPriceStatus.Active,
    providerPrices: [provider],
  });
  const plan = Object.assign(new BillingPlanEntity(), {
    id: code + '-plan',
    productId: 'product',
    code,
    status: BillingPlanStatus.Active,
    versions: [
      {
        id: code + '-v1',
        version: 1,
        status: PlanVersionStatus.Published,
        prices: [price],
        entitlements: [],
      },
    ],
  });
  return { plan, price, provider };
}
function fixture() {
  const old = catalog('basic'),
    target = catalog('pro');
  const rows = new Map<string, BillingSubscriptionEntity>();
  const checkouts = new Map<string, BillingCheckoutSessionEntity>();
  const licenses = new Map<string, BillingLicenseEntity>();
  const source = Object.assign(new BillingSubscriptionEntity(), {
    id: 'source',
    organizationId: 'org',
    productCode: 'balanz_cfdi',
    planId: old.plan.id,
    plan: old.plan,
    planCode: 'basic',
    planPriceId: old.price.id,
    planPrice: old.price,
    planPriceCode: old.price.code,
    providerPriceId: old.provider.id,
    providerPrice: old.provider,
    provider: BillingProvider.Paypal,
    providerSubscriptionId: 'I-ONE',
    status: SubscriptionStatus.Active,
    currentPeriodStart: new Date('2030-01-01'),
    currentPeriodEnd: new Date(boundary),
    nextBillingTime: new Date(boundary),
    cancelAtPeriodEnd: false,
    graceUntil: null,
    metadata: {},
    updatedAt: new Date('2030-01-01'),
  });
  rows.set(source.id, structuredClone(source));
  const snapshot = {
    id: 'I-ONE',
    status: 'ACTIVE',
    planId: 'P-basic',
    billingInfo: {
      next_billing_time: boundary,
      last_payment: { time: '2030-01-01T00:00:00.000Z' },
    },
    raw: { update_time: '2030-01-10T00:00:00.000Z' },
  };
  const transactionContext = new AsyncLocalStorage<boolean>();
  const subscriptionRepo = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        rows.has(where.id) ? structuredClone(rows.get(where.id)) : null,
      ),
    ),
    find: jest.fn(() =>
      Promise.resolve([...rows.values()].map((x) => structuredClone(x))),
    ),
    save: jest.fn((value: BillingSubscriptionEntity) => {
      rows.set(value.id, structuredClone(value));
      return Promise.resolve(value);
    }),
  };
  const checkoutRepo = {
    save: jest.fn((value: BillingCheckoutSessionEntity) => {
      checkouts.set(value.id, structuredClone(value));
      return Promise.resolve(value);
    }),
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        checkouts.has(where.id)
          ? structuredClone(checkouts.get(where.id))
          : null,
      ),
    ),
    update: jest.fn(
      (id: string, value: Partial<BillingCheckoutSessionEntity>) => {
        Object.assign(checkouts.get(id)!, structuredClone(value));
        return Promise.resolve({ affected: 1 });
      },
    ),
  };
  const licenseRepo = {
    findOne: jest.fn(({ where }: { where: { subscriptionId: string } }) =>
      Promise.resolve(licenses.get(where.subscriptionId) ?? null),
    ),
    create: (value: Partial<BillingLicenseEntity>) =>
      Object.assign(new BillingLicenseEntity(), { id: 'license' }, value),
    save: jest.fn((value: BillingLicenseEntity) => {
      licenses.set(value.subscriptionId!, value);
      return Promise.resolve(value);
    }),
  };
  const product = { id: 'product', code: 'balanz_cfdi' };
  const query = jest.fn((sql: string, args: string[] = []) => {
    if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
    if (sql.startsWith('SELECT id FROM subscriptions WHERE organization_id'))
      return Promise.resolve(
        [...rows.values()]
          .filter(
            (x) =>
              x.organizationId === args[0] &&
              x.productCode === args[1] &&
              (
                x.metadata.cancellation as
                  { idempotencyKey?: string } | undefined
              )?.idempotencyKey === args[2],
          )
          .map((x) => ({ id: x.id })),
      );
    if (sql.startsWith('SELECT id FROM checkout_sessions'))
      return Promise.resolve(
        [...checkouts.values()]
          .filter(
            (x) =>
              x.organizationId === args[0] &&
              x.productCode === args[1] &&
              x.metadata.idempotencyKey === args[2] &&
              x.metadata.createdByIssuer === args[3] &&
              x.metadata.createdByClientId === args[4],
          )
          .map((x) => ({ id: x.id })),
      );
    if (sql.startsWith('SELECT id FROM subscriptions WHERE deleted_at'))
      return Promise.resolve(
        [...rows.values()]
          .filter(
            (x) =>
              (x.metadata.cancellation as { state?: string } | undefined)
                ?.state === 'pending' ||
              ['preparing', 'awaiting_approval', 'scheduled'].includes(
                String(
                  (
                    x.metadata.pendingPlanChange as
                      { state?: string } | undefined
                  )?.state,
                ),
              ),
          )
          .map((x) => ({ id: x.id })),
      );
    throw new Error('Unexpected query ' + sql);
  });
  const manager = {
    query,
    getRepository: (entity: unknown) => {
      if (entity === BillingSubscriptionEntity) return subscriptionRepo;
      if (entity === BillingCheckoutSessionEntity) return checkoutRepo;
      if (entity === BillingLicenseEntity) return licenseRepo;
      if (entity === BillingProductEntity)
        return { findOne: () => Promise.resolve(product) };
      throw new Error('Unexpected repository');
    },
  };
  let transactions: Promise<unknown> = Promise.resolve();
  const db = {
    query,
    transaction: <T>(callback: (m: typeof manager) => Promise<T>) => {
      const result = transactions.then(async () => {
        return transactionContext.run(true, () => callback(manager));
      });
      transactions = result.catch(() => undefined);
      return result;
    },
  };
  const paypal = {
    getSubscription: jest.fn(() => {
      expect(transactionContext.getStore()).not.toBe(true);
      return Promise.resolve(structuredClone(snapshot));
    }),
    cancelSubscription: jest.fn(() => {
      expect(transactionContext.getStore()).not.toBe(true);
      snapshot.status = 'CANCELLED';
      return Promise.resolve();
    }),
    reviseSubscription: jest.fn(() => {
      expect(transactionContext.getStore()).not.toBe(true);
      return Promise.resolve({
        id: 'I-ONE',
        approvalUrl: 'https://www.paypal.com/approve',
        raw: {},
      });
    }),
  };
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const checkout = {
    preparePlanRevision: jest.fn(
      (
        _source: BillingSubscriptionEntity,
        _target: BillingPlanEntity,
        dto: { idempotencyKey: string },
        _actor: unknown,
        effectiveAt: string,
      ) => {
        const id = 'checkout-' + dto.idempotencyKey;
        if (!checkouts.has(id))
          checkouts.set(
            id,
            Object.assign(new BillingCheckoutSessionEntity(), {
              id,
              organizationId: 'org',
              productCode: 'balanz_cfdi',
              userId: 'buyer',
              planId: target.plan.id,
              plan: target.plan,
              planPriceId: target.price.id,
              planPrice: target.price,
              planPriceCode: target.price.code,
              providerPriceId: target.provider.id,
              providerPrice: target.provider,
              provider: BillingProvider.Paypal,
              providerCheckoutUrl: null,
              successUrl: changeDto.successUrl,
              cancelUrl: changeDto.cancelUrl,
              status: BillingCheckoutSessionStatus.Created,
              metadata: {
                operation: 'plan_change',
                subscriptionId: 'source',
                paypalPlanId: 'P-pro',
                effectiveAt,
                idempotencyKey: dto.idempotencyKey,
                createdByIssuer: actor.issuer,
                createdByClientId: actor.clientId,
              },
            }),
          );
        return Promise.resolve(structuredClone(checkouts.get(id)!));
      },
    ),
  };
  const entitlements = {
    resolveForSubscription: jest.fn(() =>
      Promise.resolve({
        entitlements: { includedUsers: 2 },
        billing: { baseMonthly: '499.00', currency: 'MXN' },
      }),
    ),
  };
  const service = () =>
    new BillingSubscriptionsManagementService(
      db as never,
      checkout as never,
      entitlements as never,
      paypal as never,
      new BillingLicenseCalculatorService(new BillingPlanCatalogResolver()),
      audit as never,
      new BillingPlanCatalogResolver(),
      subscriptionRepo as never,
      { findOne: () => Promise.resolve(target.plan) } as never,
      checkoutRepo as never,
    );
  const checkoutStatus = () =>
    new BillingCheckoutService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      checkoutRepo as never,
      subscriptionRepo as never,
      undefined as never,
      {
        resolve: () => Promise.resolve(undefined),
        assertCheckout: () => Promise.resolve(undefined),
      } as never,
    );
  return {
    service,
    checkoutStatus,
    rows,
    checkouts,
    licenses,
    paypal,
    snapshot,
    manager,
    query,
    checkout,
    subscriptionRepo,
  };
}

describe('durable subscription management at the next paid cycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2030-01-10T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  it('persists cancellation and paid-through access before contacting PayPal', async () => {
    const f = fixture();
    f.paypal.cancelSubscription.mockImplementationOnce(() => {
      expect(f.rows.get('source')!.cancelAtPeriodEnd).toBe(true);
      expect(f.rows.get('source')!.metadata.cancellation).toMatchObject({
        state: 'pending',
        effectiveAt: boundary,
      });
      f.snapshot.status = 'CANCELLED';
      return Promise.resolve();
    });
    const result = await f.service().cancelSubscription('source', cancelDto);
    expect(result.cancellation?.state).toBe('scheduled');
    expect(result.status).toBe(SubscriptionStatus.Cancelled);
    expect(f.licenses.get('source')).toMatchObject({
      status: LicenseStatus.Active,
      validUntil: new Date(boundary),
    });
    expect(
      (await f.service().getCurrentSubscription('org', 'balanz_cfdi')).id,
    ).toBe('source');
  });
  it('reconciles a lost cancellation response and never repeats a confirmed cancellation', async () => {
    const f = fixture();
    f.paypal.cancelSubscription.mockImplementationOnce(() => {
      f.snapshot.status = 'CANCELLED';
      return Promise.reject(new Error('response lost'));
    });
    expect(
      (await f.service().cancelSubscription('source', cancelDto)).cancellation
        ?.state,
    ).toBe('scheduled');
    await f.service().cancelSubscription('source', cancelDto);
    expect(f.paypal.cancelSubscription).toHaveBeenCalledTimes(1);
  });
  it('recovers a pending cancellation in a new service instance after an outage', async () => {
    const f = fixture();
    f.paypal.getSubscription
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    expect(
      (await f.service().cancelSubscription('source', cancelDto)).cancellation
        ?.state,
    ).toBe('pending');
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.metadata.cancellation).toMatchObject({
      state: 'scheduled',
    });
  });
  it('binds cancellation retry to the old contract even after another contract is current', async () => {
    const f = fixture();
    await f.service().cancelSubscription('source', cancelDto);
    f.rows.set(
      'new',
      Object.assign(
        new BillingSubscriptionEntity(),
        structuredClone(f.rows.get('source')!),
        {
          id: 'new',
          status: SubscriptionStatus.Active,
          cancelAtPeriodEnd: false,
          metadata: {},
          providerSubscriptionId: 'I-NEW',
        },
      ),
    );
    await f.service().cancelSubscription('new', cancelDto);
    expect(f.rows.get('new')!.cancelAtPeriodEnd).toBe(false);
    expect(f.paypal.cancelSubscription).toHaveBeenCalledTimes(1);
  });
  it('rejects changed cancellation payloads under the same key', async () => {
    const f = fixture();
    await f.service().cancelSubscription('source', cancelDto);
    await expect(
      f
        .service()
        .cancelSubscription('source', { ...cancelDto, reason: 'different' }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('uses native revision, leaves the current renewal intact and reuses one checkout', async () => {
    const f = fixture();
    const first = await f.service().changePlan('source', changeDto, actor);
    const second = await f.service().changePlan('source', changeDto, actor);
    expect(first).toMatchObject({
      newSubscriptionId: 'source',
      effectiveAt: boundary,
      state: 'awaiting_approval',
    });
    expect(second.checkoutId).toBe(first.checkoutId);
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
    expect(f.paypal.reviseSubscription).toHaveBeenCalledTimes(1);
    expect(f.rows.get('source')!.cancelAtPeriodEnd).toBe(false);
    expect(f.rows.get('source')!.planCode).toBe('basic');
  });
  it('does not treat the existing ACTIVE agreement as target approval', async () => {
    const f = fixture();
    await f.service().changePlan('source', changeDto, actor);
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toMatchObject({
      state: 'awaiting_approval',
    });
    expect(f.rows.get('source')!.planCode).toBe('basic');
  });
  it('keeps the original billing after approval is abandoned past the preview boundary', async () => {
    const f = fixture();
    await f.service().changePlan('source', changeDto, actor);
    jest.setSystemTime(new Date('2030-02-02'));
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.planCode).toBe('basic');
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toMatchObject({
      state: 'awaiting_approval',
    });
  });
  it('preserves old benefits until the paid boundary, then applies the approved paid cycle', async () => {
    const f = fixture();
    await f.service().changePlan('source', changeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toMatchObject({
      state: 'scheduled',
    });
    expect(f.rows.get('source')!.planCode).toBe('basic');
    jest.setSystemTime(new Date('2030-02-01T00:00:01Z'));
    f.snapshot.billingInfo = {
      next_billing_time: '2030-03-01T00:00:00Z',
      last_payment: { time: boundary },
    };
    await f.service().recoverManagement();
    expect(f.rows.get('source')!).toMatchObject({
      planCode: 'pro',
      planPriceCode: 'pro-monthly',
      providerSubscriptionId: 'I-ONE',
      metadata: { pendingPlanChange: { state: 'effective' } },
    });
    expect(f.licenses.get('source')).toMatchObject({
      status: LicenseStatus.Active,
      planCode: 'pro',
    });
    expect([...f.checkouts.values()][0].metadata.planChangeState).toBe(
      'effective',
    );
  });
  it('postpones a late approval to the actual next provider cycle', async () => {
    const f = fixture();
    await f.service().changePlan('source', changeDto, actor);
    jest.setSystemTime(new Date('2030-02-02'));
    f.snapshot.planId = 'P-pro';
    f.snapshot.raw.update_time = '2030-02-02T00:00:00Z';
    f.snapshot.billingInfo = {
      next_billing_time: '2030-03-01T00:00:00Z',
      last_payment: { time: boundary },
    };
    const source = f.rows.get('source')!;
    await applyConfirmedPlanChange(
      f.manager as never,
      source,
      f.snapshot,
      new Date(),
      '2030-02-02T00:00:00Z',
    );
    expect(source.metadata.pendingPlanChange).toMatchObject({
      state: 'scheduled',
      effectiveAt: '2030-03-01T00:00:00.000Z',
    });
    expect(f.rows.get('source')!.planCode).toBe('basic');
  });
  it('reconciles native approval after a response was lost without creating another agreement', async () => {
    const f = fixture();
    f.paypal.reviseSubscription.mockImplementationOnce(() => {
      f.snapshot.planId = 'P-pro';
      return Promise.reject(new Error('lost'));
    });
    await expect(
      f.service().changePlan('source', changeDto, actor),
    ).rejects.toMatchObject({ status: 502 });
    const recovered = await f.service().changePlan('source', changeDto, actor);
    expect(recovered.state).toBe('scheduled');
    expect(recovered.checkoutUrl).toBe(changeDto.successUrl);
    expect(f.paypal.reviseSubscription).toHaveBeenCalledTimes(1);
  });
  it('lets cancellation stop a scheduled native revision without applying its target benefits', async () => {
    const f = fixture();
    await f.service().changePlan('source', changeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    await f.service().cancelSubscription('source', cancelDto);
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toMatchObject({
      state: 'failed',
    });
    expect(f.rows.get('source')!.planCode).toBe('basic');
    expect(f.licenses.get('source')).toMatchObject({
      status: LicenseStatus.Active,
      validUntil: new Date(boundary),
    });
  });
  it('never restores a refund-revoked subscription during recovery', async () => {
    const f = fixture();
    await f.service().changePlan('source', changeDto, actor);
    const source = f.rows.get('source')!;
    source.metadata.refundRevocation = { refundId: 'refund' };
    source.status = SubscriptionStatus.Cancelled;
    source.cancelAtPeriodEnd = false;
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.planCode).toBe('basic');
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  });
  it('prefers an active subscription over cancelled paid-through history', async () => {
    const f = fixture();
    await f.service().cancelSubscription('source', cancelDto);
    const active = Object.assign(
      new BillingSubscriptionEntity(),
      structuredClone(f.rows.get('source')!),
      {
        id: 'active',
        status: SubscriptionStatus.Active,
        cancelAtPeriodEnd: false,
        metadata: {},
      },
    );
    f.rows.set(active.id, active);
    expect(
      (await f.service().getCurrentSubscription('org', 'balanz_cfdi')).id,
    ).toBe('active');
  });
  it('does not restart a historical key after its effective plan change was replaced', async () => {
    const f = fixture();
    await f.service().changePlan('source', changeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    jest.setSystemTime(new Date('2030-02-01T00:00:01Z'));
    f.snapshot.billingInfo = {
      next_billing_time: '2030-03-01T00:00:00Z',
      last_payment: { time: boundary },
    };
    await f.service().recoverManagement();
    const priorCalls = f.paypal.reviseSubscription.mock.calls.length;
    f.rows.get('source')!.metadata.pendingPlanChange = {
      checkoutId: 'another',
      idempotencyKey: 'new-key',
      state: 'awaiting_approval',
    };
    const result = await f.service().changePlan('source', changeDto, actor);
    expect(result.state).toBe('effective');
    expect(f.paypal.reviseSubscription).toHaveBeenCalledTimes(priorCalls);
  });
  it('uses the signed approval event time when processing resumes after the paid boundary', async () => {
    const f = fixture();
    await f.service().changePlan('source', changeDto, actor);
    jest.setSystemTime(new Date('2030-02-02'));
    f.snapshot.planId = 'P-pro';
    f.snapshot.raw.update_time = '2030-02-01T00:00:00Z';
    f.snapshot.billingInfo = {
      next_billing_time: '2030-03-01T00:00:00Z',
      last_payment: { time: boundary },
    };
    const source = f.rows.get('source')!;
    await applyConfirmedPlanChange(
      f.manager as never,
      source,
      f.snapshot,
      new Date(),
      '2030-01-15T00:00:00Z',
    );
    expect(source.metadata.pendingPlanChange).toMatchObject({
      state: 'effective',
      effectiveAt: boundary,
    });
    expect(source.planCode).toBe('pro');
  });
  it('does not infer consent time from a generic provider update after the boundary', async () => {
    const f = fixture();
    await f.service().changePlan('source', changeDto, actor);
    jest.setSystemTime(new Date('2030-02-02'));
    f.snapshot.planId = 'P-pro';
    f.snapshot.raw.update_time = '2030-02-01T00:00:00Z';
    f.snapshot.billingInfo = {
      next_billing_time: '2030-03-01T00:00:00Z',
      last_payment: { time: boundary },
    };
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.planCode).toBe('basic');
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toMatchObject({
      state: 'awaiting_approval',
      effectiveAt: boundary,
    });
  });
  it('keeps the historical checkout status after a subsequent change replaces current metadata', async () => {
    const f = fixture();
    const result = await f.service().changePlan('source', changeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    f.rows.get('source')!.metadata.pendingPlanChange = {
      checkoutId: 'another',
      state: 'awaiting_approval',
    };
    expect(
      await f.checkoutStatus().getCheckoutStatus(result.checkoutId, actor),
    ).toMatchObject({
      planChange: { state: 'scheduled', effectiveAt: boundary },
    });
  });
  it('retains frozen price and provider IDs when the catalog retires the target price', async () => {
    const f = fixture();
    const result = await f.service().changePlan('source', changeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    const receipt = f.checkouts.get(result.checkoutId)!;
    receipt.planPrice.status = PlanPriceStatus.Archived;
    receipt.providerPrice.status = ProviderPriceStatus.Archived;
    jest.setSystemTime(new Date('2030-02-01T00:00:01Z'));
    f.snapshot.billingInfo = {
      next_billing_time: '2030-03-01T00:00:00Z',
      last_payment: { time: boundary },
    };
    await f.service().recoverManagement();
    expect(f.rows.get('source')).toMatchObject({
      planPriceId: receipt.planPriceId,
      providerPriceId: receipt.providerPriceId,
      metadata: { pendingPlanChange: { state: 'effective' } },
    });
  });
  it('cancels an overdue renewable contract without extending paid access', async () => {
    const f = fixture();
    const source = f.rows.get('source')!;
    source.status = SubscriptionStatus.PastDue;
    source.currentPeriodEnd = new Date('2029-12-01');
    source.nextBillingTime = null;
    await f.service().cancelSubscription('source', cancelDto);
    expect(f.paypal.cancelSubscription).toHaveBeenCalledTimes(1);
    expect(source.currentPeriodEnd.toISOString()).toBe(
      '2029-12-01T00:00:00.000Z',
    );
    expect(f.licenses.get('source')?.status).not.toBe(LicenseStatus.Active);
  });
  it('returns a terminal failed historical receipt after cancelling a scheduled revision', async () => {
    const f = fixture();
    const result = await f.service().changePlan('source', changeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    await f.service().cancelSubscription('source', cancelDto);
    delete f.rows.get('source')!.metadata.pendingPlanChange;
    expect(
      await f.checkoutStatus().getCheckoutStatus(result.checkoutId, actor),
    ).toMatchObject({
      checkoutStatus: BillingCheckoutSessionStatus.Cancelled,
      planChange: { state: 'failed' },
    });
  });
  it('claims one cancellation when the same request runs concurrently', async () => {
    const f = fixture();
    await Promise.all([
      f.service().cancelSubscription('source', cancelDto),
      f.service().cancelSubscription('source', cancelDto),
    ]);
    expect(f.paypal.cancelSubscription).toHaveBeenCalledTimes(1);
    expect(f.rows.get('source')!.metadata.cancellation).toMatchObject({
      state: 'scheduled',
    });
  });
});
