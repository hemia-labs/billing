import { PaypalApiException } from '../../../../apps/api/src/modules/paypal/types/paypal.types';
import { BillingProviderRegistry } from '../../../../apps/api/src/modules/providers/billing-provider.registry';
import { PaypalBillingAdapter } from '../../../../apps/api/src/modules/providers/paypal-billing.adapter';
import { paypalSubscription } from '../../../../apps/api/src/modules/providers/paypal-billing.adapter';
import { providerRegistry } from '../../helpers/provider-registry';
import { AsyncLocalStorage } from 'node:async_hooks';
import { BillingCheckoutService } from '../../../../apps/api/src/modules/checkout/billing-checkout.service';
import { BillingSubscriptionsManagementService } from '../../../../apps/api/src/modules/subscriptions-management/billing-subscriptions-management.service';
import { BillingPlanCatalogResolver } from '../../../../apps/api/src/modules/catalog';
import { BillingLicenseCalculatorService } from '../../../../apps/api/src/modules/licenses';
import { BillingSubscriptionPaymentsProcessorService } from '../../../../apps/api/src/modules/webhooks/paypal/billing-subscription-payments-processor.service';
import {
  BillingPaymentEntity,
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
import {
  applyConfirmedPlanChange,
  pendingPlanChange,
  planChangeResponse,
} from '../../../../apps/api/src/modules/subscriptions-management/subscription-management-state';

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
    amount: code === 'basic' ? '499.00' : '299.00',
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
  const payments: BillingPaymentEntity[] = [];
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
              (
                x.metadata.renewalPlanCorrection as
                  { state?: string } | undefined
              )?.state === 'awaiting_approval' ||
              ['preparing','awaiting_approval','scheduled'].includes(String((x.metadata.renewalResume as {state?:string}|undefined)?.state)) ||
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
  const correctionPrices = new Map<string, BillingPlanPriceEntity>();
  const manager = {
    query,
    getRepository: (entity: unknown) => {
      if (entity === BillingPlanPriceEntity)
        return {
          findOne: ({ where }: { where: { id: string } }) =>
            Promise.resolve(correctionPrices.get(where.id) ?? null),
        };
      if (entity === BillingSubscriptionEntity) return subscriptionRepo;
      if (entity === BillingCheckoutSessionEntity) return checkoutRepo;
      if (entity === BillingLicenseEntity) return licenseRepo;
      if (entity === BillingPaymentEntity)
        return {
          findOne: ({ where }: { where: { providerCaptureId: string } }) =>
            Promise.resolve(
              payments.find(
                (x) => x.providerCaptureId === where.providerCaptureId,
              ) ?? null,
            ),
          create: (x: Partial<BillingPaymentEntity>) =>
            Object.assign(new BillingPaymentEntity(), { id: 'payment', ...x }),
          save: (x: BillingPaymentEntity) => {
            const index = payments.findIndex(
              (payment) => payment.providerCaptureId === x.providerCaptureId,
            );
            if (index < 0) payments.push(x);
            else payments[index] = x;
            return Promise.resolve(x);
          },
        };
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
  const order: {
    id: string;
    status: string;
    purchase_units: Array<{
      custom_id: string;
      amount: { value: string; currency_code: string };
      payments?: {
        captures: Array<{
          id: string;
          status: string;
          amount: { value: string; currency_code: string };
          create_time: string;
        }>;
      };
    }>;
    links?: Array<{ rel: string; href: string }>;
  } = { id: 'ORDER-ONE', status: 'CREATED', purchase_units: [] };
  const paypal = {
    createOrder: jest.fn(
      (input: {
        checkoutId: string;
        amount: string;
        currency: string;
        requestId: string;
        returnUrl: string;
        cancelUrl: string;
      }) => {
        expect(transactionContext.getStore()).not.toBe(true);
        Object.assign(order, {
          purchase_units: [
            {
              custom_id: input.checkoutId,
              amount: { value: input.amount, currency_code: input.currency },
            },
          ],
          links: [
            {
              rel: 'payer-action',
              href: 'https://www.paypal.com/order-approve',
            },
          ],
        });
        return Promise.resolve(structuredClone(order));
      },
    ),
    getOrder: jest.fn(() => Promise.resolve(structuredClone(order))),
    captureOrder: jest.fn(() => {
      expect(transactionContext.getStore()).not.toBe(true);
      order.status = 'COMPLETED';
      order.purchase_units[0].payments = {
        captures: [
          {
            id: 'CAPTURE-ONE',
            status: 'COMPLETED',
            amount: order.purchase_units[0].amount,
            create_time: new Date().toISOString(),
          },
        ],
      };
      return Promise.resolve(structuredClone(order));
    }),
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
    planChangeResponse: (
      _provider: BillingProvider,
      change: Parameters<typeof planChangeResponse>[0],
      url: string | null,
    ) => planChangeResponse(change, url),
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
  const service = (registry = providerRegistry(paypal)) =>
    new BillingSubscriptionsManagementService(
      db as never,
      checkout as never,
      entitlements as never,
      registry,
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
      providerRegistry(paypal),
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
    correctionPrices,
    audit,
    target,
    order,
    payments,
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
      state: 'failed',
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
      paypalSubscription(f.snapshot),
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
    f.checkouts.get(
      'checkout-' + changeDto.idempotencyKey,
    )!.providerCheckoutUrl = null;
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
      paypalSubscription(f.snapshot),
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

describe('immediate prorated upgrades', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2030-01-10T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  const upgradeDto = { ...changeDto, expectedAmountDueNow: '500.00' };
  function upgrade() {
    const f = fixture();
    f.target.price.amount = '999.00';
    return f;
  }
  it('abandons an unapproved plan change and allows a different request without touching the paid contract', async () => {
    const f = upgrade();
    const first = await f.service().changePlan('source', upgradeDto, actor);
    expect(
      await f.service().cancelPlanChange(first.checkoutId, 'buyer'),
    ).toEqual({ cancelled: true });
    expect(
      await f.service().cancelPlanChange(first.checkoutId, 'buyer'),
    ).toEqual({ cancelled: true });
    expect(f.rows.get('source')).toMatchObject({
      planCode: 'basic',
      status: SubscriptionStatus.Active,
      cancelAtPeriodEnd: false,
      metadata: { pendingPlanChange: { state: 'failed' } },
    });
    expect(f.checkouts.get(first.checkoutId)?.status).toBe(
      BillingCheckoutSessionStatus.Cancelled,
    );
    expect(
      (await f.service().getCurrentSubscription('org', 'balanz_cfdi'))
        .pendingPlanChange,
    ).toBeNull();
    await expect(
      f
        .service()
        .changePlan(
          'source',
          { ...upgradeDto, idempotencyKey: 'another-change' },
          actor,
        ),
    ).resolves.toMatchObject({ state: 'awaiting_approval' });
    const callsBefore = f.paypal.getSubscription.mock.calls.length;
    expect(
      (await f.service().verifyCheckoutSession(first.checkoutId))
        .checkoutStatus,
    ).toBe(BillingCheckoutSessionStatus.Cancelled);
    expect(f.paypal.getSubscription).toHaveBeenCalledTimes(callsBefore);
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
  });
  it('requires approval to restore an already approved recurring plan and never captures during cancellation', async () => {
    const f = upgrade();
    const first = await f.service().changePlan('source', upgradeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    const requestsBefore = f.paypal.reviseSubscription.mock.calls.length;
    expect(await f.service().cancelPlanChange(first.checkoutId)).toEqual({
      cancelled: false,
      approvalUrl: 'https://www.paypal.com/approve',
    });
    expect(
      (await f.service().getCurrentSubscription('org', 'balanz_cfdi'))
        .pendingPlanChange,
    ).toMatchObject({
      cancellationRequested: true,
      action: 'approve_subscription',
    });
    const change = pendingPlanChange(f.rows.get('source')!)!;
    await applyConfirmedPlanChange(f.manager as never, f.rows.get('source')!, {
      id: 'I-ONE',
      planId: 'P-pro',
      subscriptionStatus: SubscriptionStatus.Active,
      status: 'ACTIVE',
    });
    expect(change.state).toBe('awaiting_approval');
    await f.service().recoverManagement();
    expect(f.paypal.reviseSubscription).toHaveBeenCalledTimes(
      requestsBefore + 1,
    );
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
    f.snapshot.planId = 'P-basic';
    const verified = await f.service().verifyCheckoutSession(first.checkoutId);
    expect(verified.checkoutStatus).toBe(
      BillingCheckoutSessionStatus.Cancelled,
    );
    expect(
      (await f.service().getCurrentSubscription('org', 'balanz_cfdi'))
        .pendingPlanChange,
    ).toBeNull();
    expect(f.rows.get('source')!.planCode).toBe('basic');
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  });
  it.each(['captureId', 'captureAttemptedAt', 'leaseUntil'] as const)(
    'refuses to discard a change with %s',
    async (field) => {
      const f = upgrade();
      const first = await f.service().changePlan('source', upgradeDto, actor);
      const change = f.rows.get('source')!.metadata.pendingPlanChange as Record<
        string,
        unknown
      >;
      change[field] =
        field === 'captureId' ? 'CAPTURE' : '2030-01-10T00:01:00Z';
      await expect(
        f.service().cancelPlanChange(first.checkoutId),
      ).rejects.toMatchObject({ status: 409 });
      expect(change.state).toBe('awaiting_approval');
      expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
    },
  );
  it.each(['APPROVED', 'COMPLETED'])(
    'reconciles money after rejecting cancellation of a provider %s order',
    async (status) => {
      const f = upgrade();
      const first = await f.service().changePlan('source', upgradeDto, actor);
      f.snapshot.planId = 'P-pro';
      await f.service().recoverManagement();
      f.order.status = status;
      if (status === 'COMPLETED')
        await f.paypal.captureOrder.getMockImplementation()!();
      const revisions = f.paypal.reviseSubscription.mock.calls.length;
      await expect(
        f.service().cancelPlanChange(first.checkoutId),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        pendingPlanChange(f.rows.get('source')!)!.cancelRequestedAt,
      ).toBeUndefined();
      expect(f.paypal.reviseSubscription).toHaveBeenCalledTimes(revisions);
      await f.service().recoverManagement();
      expect(f.payments).toHaveLength(1);
      expect(f.rows.get('source')!.planCode).toBe('pro');
      expect(f.paypal.captureOrder).toHaveBeenCalledTimes(
        status === 'APPROVED' ? 1 : 0,
      );
    },
  );
  it('keeps a durable cancellation request after provider failure so recovery cannot capture', async () => {
    const f = upgrade();
    const first = await f.service().changePlan('source', upgradeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    f.paypal.getSubscription.mockRejectedValueOnce(
      new Error('provider unavailable'),
    );
    await expect(
      f.service().cancelPlanChange(first.checkoutId),
    ).rejects.toThrow('provider unavailable');
    expect(
      pendingPlanChange(f.rows.get('source')!)!.cancelRequestedAt,
    ).toBeTruthy();
    f.order.status = 'APPROVED';
    await f.service().recoverManagement();
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
  });
  it('uses normalized subscription status without raw provider status for consent and proration', async () => {
    const f = upgrade();
    const adapter = new PaypalBillingAdapter(f.paypal as never);
    const get = (id: string) =>
      new PaypalBillingAdapter(f.paypal as never).getSubscription(id);
    jest.spyOn(adapter, 'getSubscription').mockImplementation(async (id) => {
      const snapshot = await get(id);
      delete snapshot.status;
      return snapshot;
    });
    const registry = new BillingProviderRegistry(adapter);
    await f.service(registry).changePlan('source', upgradeDto, actor);
    f.snapshot.planId = 'P-pro';
    f.order.status = 'APPROVED';
    await f.service(registry).recoverManagement();
    expect(f.rows.get('source')!.planCode).toBe('pro');
    expect(f.paypal.captureOrder).toHaveBeenCalledTimes(1);
  });
  it('requires the accepted amount ceiling and rejects underpayment', async () => {
    const f = upgrade();
    await expect(
      f.service().changePlan('source', changeDto, actor),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f
        .service()
        .changePlan(
          'source',
          { ...upgradeDto, expectedAmountDueNow: '0.01' },
          actor,
        ),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.paypal.reviseSubscription).not.toHaveBeenCalled();
  });
  it('resumes an approved upgrade with its payment URL when no revision URL exists', async () => {
    const f = upgrade();
    const dto = { ...upgradeDto, expectedAmountDueNow: '354.84' };
    f.snapshot.planId = 'P-pro';
    const first = await f.service().changePlan('source', dto, actor);
    expect(f.checkouts.get(first.checkoutId)!.providerCheckoutUrl).toBeNull();
    expect(first).toMatchObject({
      checkoutUrl: 'https://www.paypal.com/order-approve',
      planChange: {
        action: 'approve_payment',
        checkoutUrl: 'https://www.paypal.com/order-approve',
        state: 'awaiting_approval',
      },
    });
    const resumed = await f.service().changePlan('source', dto, actor);
    expect(resumed.checkoutId).toBe(first.checkoutId);
    expect(resumed.planChange).toEqual(first.planChange);
    expect(f.paypal.createOrder).toHaveBeenCalledTimes(1);
    expect(f.paypal.reviseSubscription).not.toHaveBeenCalled();
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
    expect(f.rows.get('source')!.planCode).toBe('basic');
  });
  it('keeps an approved upgrade pending when its current payment action has no URL', async () => {
    const f = upgrade();
    const dto = { ...upgradeDto, expectedAmountDueNow: '354.84' };
    const first = await f.service().changePlan('source', dto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    const change = f.rows.get('source')!.metadata.pendingPlanChange as Record<
      string,
      unknown
    >;
    delete change.paymentApprovalUrl;
    change.leaseUntil = '2030-01-10T00:01:00.000Z';
    await expect(
      f.service().changePlan('source', dto, actor),
    ).rejects.toMatchObject({ status: 502 });
    expect(f.checkouts.get(first.checkoutId)!.providerCheckoutUrl).toBeTruthy();
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
  });
  it('requires both approvals, captures once, preserves renewal and upgrades existing license', async () => {
    const f = upgrade();
    const first = await f.service().changePlan('source', upgradeDto, actor);
    expect(first.planChange).toMatchObject({
      kind: 'upgrade',
      action: 'approve_subscription',
      amountDueNow: '354.84',
    });
    expect(f.paypal.createOrder).not.toHaveBeenCalled();
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.planCode).toBe('basic');
    const pending = await f
      .checkoutStatus()
      .getCheckoutStatus(first.checkoutId, actor);
    expect(pending.planChange).toMatchObject({
      action: 'approve_payment',
      checkoutUrl: 'https://www.paypal.com/order-approve',
    });
    f.order.status = 'APPROVED';
    await Promise.all([
      f.service().recoverManagement(),
      f.service().recoverManagement(),
    ]);
    await f.service().recoverManagement();
    expect(f.paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(f.paypal.createOrder).toHaveBeenCalledTimes(1);
    expect(f.payments).toHaveLength(1);
    expect(f.payments[0]).toMatchObject({
      amount: '354.84',
      providerCaptureId: 'CAPTURE-ONE',
      metadata: { operation: 'plan_change_proration' },
    });
    expect(f.rows.get('source')).toMatchObject({
      planCode: 'pro',
      currentPeriodStart: new Date('2030-01-01'),
      currentPeriodEnd: new Date(boundary),
    });
    expect(f.licenses.get('source')).toMatchObject({
      planCode: 'pro',
      validUntil: new Date(boundary),
    });
  });
  it('recovers a captured payment after the provider response is lost without recapturing', async () => {
    const f = upgrade();
    await f.service().changePlan('source', upgradeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    f.order.status = 'APPROVED';
    const capture = f.paypal.captureOrder.getMockImplementation()!;
    f.paypal.captureOrder.mockImplementationOnce(async () => {
      await capture();
      throw new Error('lost response');
    });
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.planCode).toBe('basic');
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.planCode).toBe('pro');
    expect(f.paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(f.payments).toHaveLength(1);
  });
  async function capturedBeforeActivationCrash() {
    const f = upgrade();
    await f.service().changePlan('source', upgradeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    f.order.status = 'APPROVED';
    const save = f.subscriptionRepo.save.getMockImplementation()!;
    let crashed = false;
    f.subscriptionRepo.save.mockImplementation((value) => {
      const change = value.metadata.pendingPlanChange as {
        captureId?: string;
        state?: string;
      };
      if (!crashed && change?.captureId && change.state === 'effective') {
        crashed = true;
        throw new Error('process crashed before saving activated benefits');
      }
      return save(value);
    });
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.planCode).toBe('basic');
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toMatchObject({
      captureId: 'CAPTURE-ONE',
      state: 'awaiting_approval',
    });
    (
      f.rows.get('source')!.metadata.pendingPlanChange as {
        leaseUntil?: string;
      }
    ).leaseUntil = '2030-01-09T00:00:00Z';
    return f;
  }
  it('reconciles captured benefits after a crash before cancelling and preserves paid B until renewal', async () => {
    const f = await capturedBeforeActivationCrash();
    await f.service().cancelSubscription('source', cancelDto);
    expect(f.rows.get('source')).toMatchObject({
      planCode: 'pro',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(boundary),
    });
    expect(f.licenses.get('source')).toMatchObject({
      planCode: 'pro',
      status: LicenseStatus.Active,
      validUntil: new Date(boundary),
    });
    expect(f.paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(f.payments).toHaveLength(1);
  });
  it('never discards a durable capture when the provider no longer confirms the target agreement', async () => {
    const f = await capturedBeforeActivationCrash();
    f.snapshot.planId = 'P-basic';
    await expect(
      f.service().cancelSubscription('source', cancelDto),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toMatchObject({
      captureId: 'CAPTURE-ONE',
      state: 'awaiting_approval',
    });
    expect(f.payments).toHaveLength(1);
  });
  it('never captures an approved order at the renewal boundary; waits for paid B renewal', async () => {
    const f = upgrade();
    await f.service().changePlan('source', upgradeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    f.order.status = 'APPROVED';
    jest.setSystemTime(new Date(boundary));
    await f.service().recoverManagement();
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
    expect(f.rows.get('source')!.planCode).toBe('basic');
    f.snapshot.billingInfo = {
      next_billing_time: '2030-03-01T00:00:00Z',
      last_payment: { time: boundary },
    };
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.planCode).toBe('pro');
    expect(f.payments).toHaveLength(0);
  });
  it('refuses a mismatched provider order amount without capture', async () => {
    const f = upgrade();
    await f.service().changePlan('source', upgradeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    f.order.status = 'APPROVED';
    f.order.purchase_units[0].amount.value = '0.01';
    await f.service().recoverManagement();
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
    expect(f.rows.get('source')!.planCode).toBe('basic');
  });
  it('rejects a stale quote if another contract replaces the source while Legal prepares checkout', async () => {
    const f = upgrade();
    const prepare = f.checkout.preparePlanRevision.getMockImplementation()!;
    f.checkout.preparePlanRevision.mockImplementationOnce((...args) => {
      const result = prepare(...args);
      f.rows.get('source')!.planPriceId = 'another-contracted-price';
      return result;
    });
    await expect(
      f.service().changePlan('source', upgradeDto, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.paypal.reviseSubscription).not.toHaveBeenCalled();
    expect(f.paypal.createOrder).not.toHaveBeenCalled();
  });
  it('recalculates a lower charge when recurring approval arrives days after the accepted maximum', async () => {
    const f = upgrade();
    await f.service().changePlan('source', upgradeDto, actor);
    jest.setSystemTime(new Date('2030-01-24'));
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    expect(f.paypal.createOrder).toHaveBeenCalledTimes(1);
    expect(f.paypal.createOrder.mock.calls[0][0]).toMatchObject({
      amount: '129.03',
    });
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toMatchObject({
      quote: { amountDueNow: '129.03' },
    });
  });
  it('recovers an expired missing order without capturing it', async () => {
    const f = upgrade();
    const quote = await f
      .service()
      .quotePlanChange(
        'source',
        upgradeDto.targetPlanCode,
        upgradeDto.targetPlanPriceCode,
      );
    const first = await f
      .service()
      .changePlan(
        'source',
        { ...upgradeDto, expectedAmountDueNow: quote.amountDueNow },
        actor,
      );
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    jest.setSystemTime(new Date('2030-01-24'));
    f.paypal.getOrder.mockRejectedValueOnce(
      new PaypalApiException('Missing', 404, '/v2/checkout/orders/ORDER'),
    );
    await f.service().verifyCheckoutSession(first.checkoutId);
    expect(f.paypal.createOrder).toHaveBeenCalledTimes(2);
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
  });
  it('replaces an expired approved order with a lower quote and requires new payment approval', async () => {
    const f = upgrade();
    const first = await f.service().changePlan('source', upgradeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    const originalRequestId = f.paypal.createOrder.mock.calls[0][0].requestId;
    jest.setSystemTime(new Date('2030-01-24'));
    f.order.status = 'APPROVED';
    f.paypal.createOrder.mockImplementationOnce((input) => {
      Object.assign(f.order, {
        id: 'ORDER-NEW',
        status: 'CREATED',
        purchase_units: [
          {
            custom_id: input.checkoutId,
            amount: { value: input.amount, currency_code: input.currency },
          },
        ],
        links: [
          { rel: 'payer-action', href: 'https://www.paypal.com/order-new' },
        ],
      });
      return Promise.resolve(structuredClone(f.order));
    });
    await f.service().recoverManagement();
    expect(f.paypal.createOrder).toHaveBeenCalledTimes(1);
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
    await f.service().verifyCheckoutSession(first.checkoutId);
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
    expect(f.paypal.createOrder).toHaveBeenCalledTimes(2);
    expect(f.paypal.createOrder.mock.calls[1][0]).toMatchObject({
      amount: '129.03',
    });
    expect(f.paypal.createOrder.mock.calls[1][0].requestId).not.toBe(
      originalRequestId,
    );
    expect(
      (await f.checkoutStatus().getCheckoutStatus(first.checkoutId, actor))
        .planChange,
    ).toMatchObject({
      action: 'approve_payment',
      amountDueNow: '129.03',
      checkoutUrl: 'https://www.paypal.com/order-new',
    });
    f.order.status = 'APPROVED';
    await f.service().recoverManagement();
    expect(f.paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(f.payments[0]).toMatchObject({ amount: '129.03' });
    expect(f.rows.get('source')!.planCode).toBe('pro');
  });
  it('reconciles the original completed capture after quote expiry without replacing or charging another order', async () => {
    const f = upgrade();
    await f.service().changePlan('source', upgradeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    f.order.status = 'APPROVED';
    const capture = f.paypal.captureOrder.getMockImplementation()!;
    f.paypal.captureOrder.mockImplementationOnce(async () => {
      await capture();
      throw new Error('lost response');
    });
    await f.service().recoverManagement();
    jest.setSystemTime(new Date('2030-01-24'));
    await f.service().recoverManagement();
    expect(f.paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(f.paypal.createOrder).toHaveBeenCalledTimes(1);
    expect(f.payments[0]).toMatchObject({ amount: '354.84' });
    expect(f.rows.get('source')!.planCode).toBe('pro');
  });
  it('returns a frozen pending quote even after time passes', async () => {
    const f = upgrade();
    await f.service().changePlan('source', upgradeDto, actor);
    jest.setSystemTime(new Date('2030-01-11'));
    expect(
      await f.service().quotePlanChange('source', 'pro', 'pro-monthly'),
    ).toMatchObject({ amountDueNow: '354.84' });
  });
});

describe('durable renewal plan correction without another charge', () => {
  function correctionFixture() {
    const f = fixture();
    const row = f.rows.get('source')!;
    row.planPrice.amount = '999.00';
    const original = Object.assign(
      new BillingPlanPriceEntity(),
      structuredClone(row.planPrice),
      {
        planVersionId: 'original-version',
        planVersion: {
          id: 'original-version',
          planId: row.planId,
          plan: row.plan,
          entitlements: [
            { featureId: 'feature-a', valueJson: { enabled: true, limit: 3 } },
            { featureId: 'feature-b', valueJson: 700 },
          ],
        },
      },
    );
    const targetProvider = Object.assign(new BillingProviderPriceEntity(), {
      ...row.providerPrice,
      id: 'corrected-provider',
      providerPriceId: 'P-correct-despacho',
      planPriceId: 'corrected-price',
    });
    const targetPrice = Object.assign(new BillingPlanPriceEntity(), original, {
      id: 'corrected-price',
      planVersionId: 'corrected-version',
      planVersion: {
        ...original.planVersion,
        id: 'corrected-version',
        entitlements: [
          { featureId: 'feature-b', valueJson: 700 },
          { featureId: 'feature-a', valueJson: { limit: 3, enabled: true } },
        ],
      },
      providerPrices: [targetProvider],
    });
    f.correctionPrices.set(original.id, original);
    f.correctionPrices.set(targetPrice.id, targetPrice);
    const paidChange = {
      state: 'effective',
      checkoutId: 'already-paid',
      captureId: 'PAID-CAPTURE',
      paymentOrderId: 'PAID-ORDER',
      capturedAt: '2030-01-10T00:00:00Z',
    };
    row.metadata = {
      pendingPlanChange: paidChange,
      renewalPlanCorrection: {
        state: 'awaiting_approval',
        requestId: 'correction-request',
        sourcePlanPriceId: original.id,
        sourceProviderPriceId: row.providerPriceId,
        targetPlanPriceId: targetPrice.id,
        targetProviderPriceId: targetProvider.id,
        targetProviderPlanId: targetProvider.providerPriceId,
        requestedAt: '2030-01-10T00:00:00Z',
      },
    };
    f.payments.push(
      Object.assign(new BillingPaymentEntity(), {
        providerCaptureId: 'PAID-CAPTURE',
        amount: '354.84',
      }),
    );
    return { ...f, row, targetPrice, targetProvider, paidChange };
  }
  it('waits for authoritative provider approval without changing the catalog contract', async () => {
    const f = correctionFixture();
    expect(await f.service().reconcileRenewalPlanCorrection('source')).toBe(
      false,
    );
    expect(f.rows.get('source')!.planPriceId).toBe('basic-price');
    expect(f.subscriptionRepo.save).not.toHaveBeenCalled();
    expect(f.paypal.reviseSubscription).not.toHaveBeenCalled();
    expect(f.paypal.createOrder).not.toHaveBeenCalled();
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
  });
  it('recovers only after approval, preserves paid dates and capture, and audits exactly once', async () => {
    const f = correctionFixture();
    const dates = [
      f.row.currentPeriodStart,
      f.row.currentPeriodEnd,
      f.row.nextBillingTime,
    ];
    const payments = structuredClone(f.payments);
    f.snapshot.planId = 'P-correct-despacho';
    await f.service().recoverManagement();
    const saved = f.rows.get('source')!;
    expect(saved).toMatchObject({
      planCode: 'basic',
      planPriceId: 'corrected-price',
      providerPriceId: 'corrected-provider',
      metadata: {
        renewalPlanCorrection: {
          state: 'effective',
          confirmedAt: expect.any(String) as string,
        },
      },
    });
    expect([
      saved.currentPeriodStart,
      saved.currentPeriodEnd,
      saved.nextBillingTime,
    ]).toEqual(dates);
    expect(saved.metadata.pendingPlanChange).toEqual(f.paidChange);
    expect(f.payments).toEqual(payments);
    expect(await f.service().reconcileRenewalPlanCorrection('source')).toBe(
      true,
    );
    expect(f.audit.record).toHaveBeenCalledTimes(1);
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.renewal_plan_corrected',
      }),
    );
    expect(f.paypal.reviseSubscription).not.toHaveBeenCalled();
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
    expect(f.paypal.createOrder).not.toHaveBeenCalled();
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
  });
  it.each([
    { amount: '1000.00' },
    { currency: 'USD' },
    { billingIntervalCount: 2 },
  ])('refuses to change contracted price terms: %j', async (patch) => {
    const f = correctionFixture();
    Object.assign(f.targetPrice, patch);
    f.snapshot.planId = 'P-correct-despacho';
    await expect(
      f.service().reconcileRenewalPlanCorrection('source'),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.rows.get('source')!.planPriceId).toBe('basic-price');
    expect(f.subscriptionRepo.save).not.toHaveBeenCalled();
  });
  it('rejects different entitlements on an equally priced correction version', async () => {
    const f = correctionFixture();
    f.targetPrice.planVersion.entitlements[0].valueJson = 1000;
    f.snapshot.planId = 'P-correct-despacho';
    await expect(
      f.service().reconcileRenewalPlanCorrection('source'),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.subscriptionRepo.save).not.toHaveBeenCalled();
  });
  it('rejects another plan or provider despite a matching remote plan identifier', async () => {
    const f = correctionFixture();
    f.targetPrice.planVersion = {
      ...f.targetPrice.planVersion,
      planId: 'another-plan',
    };
    f.snapshot.planId = 'P-correct-despacho';
    await expect(
      f.service().reconcileRenewalPlanCorrection('source'),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.subscriptionRepo.save).not.toHaveBeenCalled();
  });
  it('lets cancellation supersede an unapproved renewal correction without another charge', async () => {
    const f = correctionFixture();
    const correction = structuredClone(f.row.metadata.renewalPlanCorrection);
    const paidThrough = f.row.currentPeriodEnd;
    await expect(
      f.service().changePlan('source', changeDto, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.paypal.getSubscription).not.toHaveBeenCalled();
    const result = await f.service().cancelSubscription('source', cancelDto);
    expect(result).toMatchObject({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: paidThrough,
      cancellation: { state: 'scheduled' },
    });
    expect(f.rows.get('source')!.metadata.renewalPlanCorrection).toMatchObject({
      ...correction,
      state: 'cancelled',
      cancelledAt: expect.any(String) as string,
    });
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toEqual(
      f.paidChange,
    );
    expect(f.payments).toHaveLength(1);
    expect(f.rows.get('source')!.planPriceId).toBe('basic-price');
    expect(await f.service().reconcileRenewalPlanCorrection('source')).toBe(
      false,
    );
    await f.service().cancelSubscription('source', cancelDto);
    await f.service().recoverManagement();
    expect(f.paypal.cancelSubscription).toHaveBeenCalledTimes(1);
    expect(f.paypal.reviseSubscription).not.toHaveBeenCalled();
    expect(f.paypal.createOrder).not.toHaveBeenCalled();
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
  });
  it('rejects an in-flight plan revision when correction is prepared during Legal I/O', async () => {
    const f = correctionFixture();
    const correction = f.row.metadata.renewalPlanCorrection;
    delete f.row.metadata.renewalPlanCorrection;
    const prepare = f.checkout.preparePlanRevision.getMockImplementation()!;
    f.checkout.preparePlanRevision.mockImplementationOnce((...args) => {
      const result = prepare(...args);
      f.rows.get('source')!.metadata.renewalPlanCorrection = correction;
      return result;
    });
    await expect(
      f.service().changePlan('source', changeDto, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.paypal.reviseSubscription).not.toHaveBeenCalled();
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toEqual(
      f.paidChange,
    );
  });
  it('retires a correction created after the initial cancellation read under the subscription lock', async () => {
    const f = correctionFixture();
    const correction = f.row.metadata.renewalPlanCorrection;
    delete f.row.metadata.renewalPlanCorrection;
    const read = f.subscriptionRepo.findOne.getMockImplementation()!;
    f.subscriptionRepo.findOne.mockImplementationOnce((args) => {
      const result = read(args);
      f.rows.get('source')!.metadata.renewalPlanCorrection = correction;
      return result;
    });
    await expect(
      f.service().cancelSubscription('source', cancelDto),
    ).resolves.toMatchObject({ cancellation: { state: 'scheduled' } });
    expect(f.paypal.cancelSubscription).toHaveBeenCalledTimes(1);
    expect(f.rows.get('source')!.metadata.renewalPlanCorrection).toMatchObject({
      state: 'cancelled',
    });
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toEqual(
      f.paidChange,
    );
    expect(f.paypal.reviseSubscription).not.toHaveBeenCalled();
  });
  it('cannot apply a provider correction response that arrives after cancellation reserved the subscription', async () => {
    const f = correctionFixture();
    f.snapshot.planId = 'P-correct-despacho';
    const approvedSnapshot = structuredClone(f.snapshot);
    let finishRead!: (value: typeof approvedSnapshot) => void;
    f.paypal.getSubscription.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const correction = f.service().reconcileRenewalPlanCorrection('source');
    await new Promise<void>((resolve) => setImmediate(resolve));
    await f.service().cancelSubscription('source', cancelDto);
    finishRead(approvedSnapshot);
    await expect(correction).rejects.toMatchObject({ status: 409 });
    expect(f.rows.get('source')!).toMatchObject({
      planPriceId: 'basic-price',
      status: SubscriptionStatus.Cancelled,
      metadata: { renewalPlanCorrection: { state: 'cancelled' } },
    });
    expect(f.rows.get('source')!.metadata.pendingPlanChange).toEqual(
      f.paidChange,
    );
    expect(f.paypal.captureOrder).not.toHaveBeenCalled();
    expect(f.paypal.reviseSubscription).not.toHaveBeenCalled();
  });
  it('does not overwrite a newer contract while provider verification is in flight', async () => {
    const f = correctionFixture();
    f.snapshot.planId = 'P-correct-despacho';
    const read = f.paypal.getSubscription.getMockImplementation()!;
    f.paypal.getSubscription.mockImplementationOnce(() => {
      f.rows.get('source')!.planPriceId = 'another-contracted-price';
      return read();
    });
    await expect(
      f.service().reconcileRenewalPlanCorrection('source'),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.subscriptionRepo.save).not.toHaveBeenCalled();
  });
});

describe('durable pending checkout recovery', () => {
  it('resolves the central attempt only for a pending contract and the authenticated service', async () => {
    const f = fixture();
    const source = f.rows.get('source')!;
    source.status = SubscriptionStatus.Pending;
    const attemptId = '11111111-1111-4111-8111-111111111111';
    f.query.mockResolvedValueOnce([{ id: attemptId }] as never);
    const result = await f
      .service()
      .getCurrentSubscription('org', 'balanz_cfdi', actor);
    expect(result.pendingCheckoutAttemptId).toBe(attemptId);
    expect(f.query).toHaveBeenCalledWith(
      expect.stringContaining('a.created_by_issuer=$4'),
      ['org', 'balanz_cfdi', 'source', actor.issuer, actor.clientId],
    );
    expect(f.query.mock.calls[0][0]).toContain(
      "c.metadata->>'createdByClientId'=$5",
    );
    expect(f.query.mock.calls[0][0]).toContain(
      "c.metadata->>'subscriptionId'=$3",
    );
    f.query.mockClear();
    expect(
      (await f.service().getCurrentSubscription('org', 'balanz_cfdi'))
        .pendingCheckoutAttemptId,
    ).toBeUndefined();
    expect(f.query).not.toHaveBeenCalled();
    source.status = SubscriptionStatus.Active;
    expect(
      (await f.service().getCurrentSubscription('org', 'balanz_cfdi', actor))
        .pendingCheckoutAttemptId,
    ).toBeUndefined();
    expect(f.query).not.toHaveBeenCalled();
  });
});

function pendingCheckoutFixture() {
  const f = fixture();
  const source = f.rows.get('source')!;
  Object.assign(source, {
    status: SubscriptionStatus.Pending,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    nextBillingTime: null,
  });
  f.snapshot.status = 'APPROVAL_PENDING';
  f.snapshot.billingInfo = {} as typeof f.snapshot.billingInfo;
  const checkoutId = 'initial-checkout';
  f.checkouts.set(
    checkoutId,
    Object.assign(new BillingCheckoutSessionEntity(), {
      id: checkoutId,
      userId: 'buyer',
      organizationId: 'org',
      productCode: 'balanz_cfdi',
      provider: BillingProvider.Paypal,
      status: BillingCheckoutSessionStatus.Pending,
      metadata: {
        subscriptionId: 'source',
        createdByIssuer: actor.issuer,
        createdByClientId: actor.clientId,
      },
    }),
  );
  const buyer = {
    organizationId: 'org',
    productCode: 'balanz_cfdi',
    userId: 'buyer',
  };
  return { ...f, checkoutId, buyer };
}
describe('discard an unapproved initial checkout', () => {
  it('abandons only its pending contract locally and replays without a provider mutation', async () => {
    const f = pendingCheckoutFixture();
    expect(
      await f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
    ).toEqual({ cancelled: true, abandoned: true });
    expect(f.rows.get('source')!.status).toBe(SubscriptionStatus.Cancelled);
    expect(f.checkouts.get(f.checkoutId)!.status).toBe(
      BillingCheckoutSessionStatus.Cancelled,
    );
    expect(
      await f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
    ).toEqual({ cancelled: true, abandoned: true });
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  });
  it.each(['ACTIVE', 'APPROVED', 'SUSPENDED'])(
    'refuses provider state %s before any cancellation',
    async (status) => {
      const f = pendingCheckoutFixture();
      f.snapshot.status = status;
      await expect(
        f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
      expect(f.rows.get('source')!.status).toBe(SubscriptionStatus.Pending);
    },
  );
  it('refuses paid evidence and local active contracts', async () => {
    const f = pendingCheckoutFixture();
    f.snapshot.billingInfo = {
      last_payment: { time: '2030-01-01T00:00:00Z' },
    } as typeof f.snapshot.billingInfo;
    await expect(
      f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
    ).rejects.toMatchObject({ status: 409 });
    f.rows.get('source')!.status = SubscriptionStatus.Active;
    await expect(
      f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  });
  it('recovers a lost provider cancellation response without cancelling a second time', async () => {
    const f = pendingCheckoutFixture();
    f.paypal.cancelSubscription.mockImplementationOnce(() => {
      f.snapshot.status = 'CANCELLED';
      return Promise.reject(new Error('response lost'));
    });
    expect(
      await f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
    ).toEqual({ cancelled: true, abandoned: true });
    f.snapshot.status = 'ACTIVE';
    await f.service().reconcileAbandonedCheckout('source');
    expect(f.paypal.cancelSubscription).toHaveBeenCalledTimes(1);
    expect(
      (
        f.rows.get('source')!.metadata.checkoutAbandonment as {
          providerCancellation: { state: string };
        }
      ).providerCancellation.state,
    ).toBe('completed');
  });
  it('preserves an unresolved contract on provider outage and isolates buyer, organization and client', async () => {
    const f = pendingCheckoutFixture();
    for (const patch of [
      { userId: 'other' },
      { organizationId: 'other' },
      { productCode: 'other' },
    ])
      await expect(
        f
          .service()
          .cancelPendingCheckout(f.checkoutId, { ...f.buyer, ...patch }, actor),
      ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service().cancelPendingCheckout(f.checkoutId, f.buyer, {
        ...actor,
        clientId: 'other',
      }),
    ).rejects.toMatchObject({ status: 404 });
    f.paypal.getSubscription.mockRejectedValueOnce(new Error('offline'));
    await expect(
      f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
    ).rejects.toThrow('offline');
    expect(f.rows.get('source')!.status).toBe(SubscriptionStatus.Pending);
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  });
});

test('discard never cancels a contract activated by a webhook during the provider read', async () => {
  const f = pendingCheckoutFixture();
  const read = f.paypal.getSubscription.getMockImplementation()!;
  f.paypal.getSubscription.mockImplementationOnce(() => {
    f.rows.get('source')!.status = SubscriptionStatus.Active;
    return read();
  });
  await expect(
    f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
});

test('discard preserves the previous plan and refuses an active or paid final provider response', async () => {
  const f = pendingCheckoutFixture();
  const previous = structuredClone(f.rows.get('source')!);
  previous.id = 'previous';
  previous.status = SubscriptionStatus.Active;
  previous.planCode = 'previous-plan';
  f.rows.set(previous.id, previous);
  const savedPrevious = structuredClone(previous);
  f.paypal.getSubscription.mockImplementationOnce(() => {
    f.snapshot.status = 'ACTIVE';
    return Promise.resolve(structuredClone(f.snapshot));
  });
  await expect(
    f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    f.checkouts.get(f.checkoutId)!.metadata.pendingCheckoutDiscarded,
  ).toBeUndefined();
  expect(f.rows.get('source')!.status).toBe(SubscriptionStatus.Pending);
  expect(f.rows.get('previous')).toEqual(savedPrevious);
  f.snapshot.status = 'APPROVAL_PENDING';
  expect(
    await f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
  ).toEqual({ cancelled: true, abandoned: true });
  expect(f.rows.get('previous')).toEqual(savedPrevious);
});

test.each(['paid-period', 'provider-id'])(
  'discard revalidates %s under the final lock',
  async (change) => {
    const f = pendingCheckoutFixture();
    f.paypal.getSubscription.mockImplementationOnce(() => {
      const source = f.rows.get('source')!;
      if (change === 'paid-period') {
        source.status = SubscriptionStatus.Cancelled;
        source.currentPeriodEnd = new Date('2030-02-01');
      } else source.providerSubscriptionId = 'I-REPLACED';
      return Promise.resolve(structuredClone(f.snapshot));
    });
    await expect(
      f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      f.checkouts.get(f.checkoutId)!.metadata.pendingCheckoutDiscarded,
    ).toBeUndefined();
  },
);
test('discard preserves concurrent checkout metadata and refuses replay after paid period evidence arrives', async () => {
  const f = pendingCheckoutFixture();
  f.paypal.getSubscription.mockImplementationOnce(() => {
    f.checkouts.get(f.checkoutId)!.metadata.concurrentEvent = 'kept';
    return Promise.resolve(structuredClone(f.snapshot));
  });
  expect(
    await f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
  ).toEqual({ cancelled: true, abandoned: true });
  expect(f.checkouts.get(f.checkoutId)!.metadata.concurrentEvent).toBe('kept');
  f.rows.get('source')!.currentPeriodEnd = new Date('2030-02-01');
  await expect(
    f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor),
  ).rejects.toMatchObject({ status: 409 });
});

it('polls abandoned agreements without events and only cancels the old contract after late activation', async () => {
  const f = pendingCheckoutFixture();
  await f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor);
  await f.service().reconcileAbandonedCheckout('source');
  expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  const marker = f.rows.get('source')!.metadata
    .checkoutAbandonment as import('../../../../apps/api/src/modules/subscriptions-management/subscription-management-state').CheckoutAbandonment;
  marker.providerCancellation.nextAttemptAt = new Date(0).toISOString();
  f.snapshot.status = 'ACTIVE';
  f.snapshot.billingInfo = {
    last_payment: { time: '2030-01-01T00:00:00Z' },
  } as typeof f.snapshot.billingInfo;
  await f.service().reconcileAbandonedCheckout('source');
  expect(f.paypal.cancelSubscription).toHaveBeenCalledTimes(1);
  expect(f.rows.get('source')).toMatchObject({
    status: SubscriptionStatus.Cancelled,
    metadata: {
      checkoutAbandonment: {
        providerCancellation: { state: 'completed' },
        refundReview: { state: 'required' },
      },
    },
  });
  await f.service().reconcileAbandonedCheckout('source');
  expect(f.paypal.cancelSubscription).toHaveBeenCalledTimes(1);
});
it('manual verification and historical status cannot reactivate an abandoned checkout', async () => {
  const f = pendingCheckoutFixture();
  await f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor);
  f.snapshot.status = 'ACTIVE';
  expect(await f.service().verifyCheckoutSession(f.checkoutId)).toMatchObject({
    subscriptionStatus: SubscriptionStatus.Cancelled,
    checkoutStatus: BillingCheckoutSessionStatus.Cancelled,
  });
  expect(
    await f.checkoutStatus().getCheckoutStatus(f.checkoutId, actor),
  ).toMatchObject({
    abandoned: true,
    subscriptionStatus: SubscriptionStatus.Cancelled,
  });
});
it('abandonment recovery releases a failed provider lease and remains retryable', async () => {
  const f = pendingCheckoutFixture();
  await f.service().cancelPendingCheckout(f.checkoutId, f.buyer, actor);
  f.paypal.getSubscription.mockRejectedValueOnce(new Error('offline'));
  await f.service().reconcileAbandonedCheckout('source');
  expect(f.rows.get('source')!.metadata.checkoutAbandonment).toMatchObject({
    providerCancellation: { state: 'pending', attempts: 1 },
  });
  expect(
    (
      f.rows.get('source')!.metadata.checkoutAbandonment as {
        providerCancellation: { leaseToken?: string };
      }
    ).providerCancellation.leaseToken,
  ).toBeUndefined();
});

it('recovers cancellation approval for a scheduled downgrade and preserves paid plan, period and charges', async () => {
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10T00:00:00Z'));
  try {
    const f = fixture();
    const first = await f.service().changePlan('source', changeDto, actor);
    f.snapshot.planId = 'P-pro';
    await f.service().recoverManagement();
    expect(pendingPlanChange(f.rows.get('source')!)!.state).toBe('scheduled');
    const beforePayments = structuredClone(f.payments);
    expect(await f.service().cancelPlanChange(first.checkoutId, 'buyer')).toEqual({cancelled:false,approvalUrl:'https://www.paypal.com/approve'});
    expect((await f.service().getCurrentSubscription('org','balanz_cfdi')).pendingPlanChange).toMatchObject({state:'scheduled',cancellationRequested:true,action:'approve_subscription',checkoutUrl:'https://www.paypal.com/approve'});
    expect((await f.checkoutStatus().getCheckoutStatus(first.checkoutId,actor)).planChange).toMatchObject({state:'scheduled',cancellationRequested:true,action:'approve_subscription',checkoutUrl:'https://www.paypal.com/approve'});
    const calls = f.paypal.reviseSubscription.mock.calls.length;
    expect(await f.service().cancelPlanChange(first.checkoutId, 'buyer')).toEqual({cancelled:false,approvalUrl:'https://www.paypal.com/approve'});
    expect(f.paypal.reviseSubscription).toHaveBeenCalledTimes(calls);
    f.snapshot.planId = 'P-basic';
    await f.service().recoverManagement();
    expect(pendingPlanChange(f.rows.get('source')!)!.state).toBe('failed');
    expect((await f.service().getCurrentSubscription('org','balanz_cfdi')).pendingPlanChange).toBeNull();
    expect(await f.service().cancelPlanChange(first.checkoutId, 'buyer')).toEqual({cancelled:true});
    expect(f.rows.get('source')).toMatchObject({status:SubscriptionStatus.Active,planCode:'basic',providerSubscriptionId:'I-ONE',currentPeriodEnd:new Date(boundary),nextBillingTime:new Date(boundary),cancelAtPeriodEnd:false});
    expect(f.payments).toEqual(beforePayments);expect(f.paypal.createOrder).not.toHaveBeenCalled();expect(f.paypal.captureOrder).not.toHaveBeenCalled();expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  } finally {jest.useRealTimers()}
});

it.each([false,true])('refuses reverting a scheduled downgrade at its billing boundary and releases stale cancellation intent (paid=%s)',async paid=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10T00:00:00Z'));
  try {
    const f=fixture();const first=await f.service().changePlan('source',changeDto,actor);
    f.snapshot.planId='P-pro';await f.service().recoverManagement();
    await f.service().cancelPlanChange(first.checkoutId,'buyer');
    const marker=pendingPlanChange(f.rows.get('source')!)!;
    expect(marker.cancelRequestedAt).toBeDefined();
    const revisions=f.paypal.reviseSubscription.mock.calls.length;
    jest.setSystemTime(new Date(boundary));
    if(paid) {
      f.snapshot.billingInfo.last_payment={time:boundary};
      f.snapshot.billingInfo.next_billing_time='2030-03-01T00:00:00.000Z';
    }
    await expect(f.service().cancelPlanChange(first.checkoutId,'buyer')).rejects.toMatchObject({status:409});
    expect(f.paypal.reviseSubscription).toHaveBeenCalledTimes(revisions);
    const current=pendingPlanChange(f.rows.get('source')!)!;
    expect(current.cancelRequestedAt).toBeUndefined();expect(current.cancelApprovalUrl).toBeUndefined();
    expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();expect(f.paypal.captureOrder).not.toHaveBeenCalled();expect(f.payments).toHaveLength(0);
    if(paid) {
      await f.service().recoverManagement();
      expect(f.rows.get('source')!.planCode).toBe('pro');
      expect(pendingPlanChange(f.rows.get('source')!)!.state).toBe('effective');
    } else expect(f.rows.get('source')!.planCode).toBe('basic');
  } finally {jest.useRealTimers()}
});
it('keeps cancellation approval unavailable until a restoration URL exists, never falling back to the original checkout',()=>{
  const change={state:'scheduled',effectiveAt:boundary,cancelRequestedAt:'2030-01-10T00:00:00Z'} as Parameters<typeof planChangeResponse>[0];
  expect(planChangeResponse(change,'https://www.paypal.com/original-approval')).toMatchObject({state:'scheduled',cancellationRequested:true,action:'approve_subscription',checkoutUrl:null});
});

it.each(['provider-payment','local-period'])('refuses scheduled cancellation when %s arrives during provider revision',async evidence=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10T00:00:00Z'));
  try {
    const f=fixture();const first=await f.service().changePlan('source',changeDto,actor);
    f.snapshot.planId='P-pro';await f.service().recoverManagement();
    f.paypal.reviseSubscription.mockImplementationOnce(async()=>{
      if(evidence==='provider-payment') f.snapshot.billingInfo.last_payment={time:boundary};
      else f.rows.get('source')!.currentPeriodStart=new Date(boundary);
      f.snapshot.planId='P-basic';
      return {approvalUrl:'https://www.paypal.com/approve'};
    });
    await expect(f.service().cancelPlanChange(first.checkoutId,'buyer')).rejects.toMatchObject({status:409});
    const current=pendingPlanChange(f.rows.get('source')!)!;
    expect(current.state).toBe('scheduled');expect(current.cancelRequestedAt).toBeUndefined();expect(current.cancelApprovalUrl).toBeUndefined();
    expect(f.rows.get('source')!.planCode).toBe('basic');expect(f.payments).toHaveLength(0);expect(f.paypal.captureOrder).not.toHaveBeenCalled();
  } finally {jest.useRealTimers()}
});

function futureRenewalFixture(){
  const f=pendingCheckoutFixture();
  const prior=structuredClone(f.rows.get('source')!);Object.assign(prior,{id:'previous-paid',providerSubscriptionId:'I-PREVIOUS',status:SubscriptionStatus.Cancelled,cancelAtPeriodEnd:true,currentPeriodStart:new Date('2030-01-01'),currentPeriodEnd:new Date(boundary),metadata:{cancellation:{state:'scheduled'}}});f.rows.set(prior.id,prior);
  f.licenses.set(prior.id,Object.assign(new BillingLicenseEntity(),{id:'paid-license',subscriptionId:prior.id,status:LicenseStatus.Active,planCode:prior.planCode,validUntil:new Date(boundary)}));
  f.rows.get('source')!.metadata.renewalResume={state:'awaiting_approval',sourceSubscriptionId:prior.id,effectiveAt:boundary,amountDueNow:'0.00',recurringAmount:'499.00',currency:'MXN',providerPlanId:'P-basic',checkoutId:f.checkoutId,attemptId:'future-attempt'};
  Object.assign(f.checkouts.get(f.checkoutId)!,{plan:prior.plan,planId:prior.planId,planPrice:prior.planPrice,planPriceId:prior.planPriceId,planPriceCode:prior.planPriceCode,providerPrice:prior.providerPrice,providerPriceId:prior.providerPriceId,successUrl:changeDto.successUrl,cancelUrl:changeDto.cancelUrl});
  f.snapshot.status='ACTIVE';
  return {...f,prior};
}
it('future renewal recovery keeps the paid source current and grants the replacement only after a verified future transaction',async()=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10'));
  try {
    const f=futureRenewalFixture();const before=structuredClone({prior:f.prior,license:f.licenses.get(f.prior.id)});
    await f.service().recoverManagement();
    expect(f.rows.get('source')!.status).toBe(SubscriptionStatus.Pending);
    expect(f.rows.get('source')!.metadata.renewalResume).toMatchObject({state:'scheduled'});
    expect(f.licenses.has('source')).toBe(false);
    expect(await f.service().getCurrentSubscription('org','balanz_cfdi',actor)).toMatchObject({id:f.prior.id,pendingRenewal:{attemptId:'future-attempt',subscriptionId:'source',state:'scheduled',checkoutUrl:null}});
    jest.setSystemTime(new Date(boundary));
    f.snapshot.billingInfo={last_payment:{time:boundary},next_billing_time:'2030-03-01T00:00:00Z'};
    Object.assign(f.paypal,{getSubscriptionTransactions:jest.fn(async()=>({transactions:[{id:'FUTURE-SALE',status:'COMPLETED',time:boundary,amount_with_breakdown:{gross_amount:{value:'499.00',currency_code:'MXN'}}}]}))});
    await f.service().recoverManagement();await f.service().recoverManagement();
    expect(f.rows.get('source')!.status).toBe(SubscriptionStatus.Active);
    expect(f.rows.get('source')!.metadata.renewalResume).toMatchObject({state:'effective',paidCaptureId:'FUTURE-SALE'});
    expect(f.payments).toHaveLength(1);
    expect(f.licenses.get('source')).toMatchObject({status:LicenseStatus.Active});
    expect(f.rows.get(f.prior.id)).toEqual(before.prior);expect(f.licenses.get(f.prior.id)).toEqual(before.license);
    expect(f.paypal.createOrder).not.toHaveBeenCalled();expect(f.paypal.captureOrder).not.toHaveBeenCalled();
  }finally{jest.useRealTimers()}
});
it.each(['recovery-first', 'webhook-first'])(
  'records an early 499 MXN charge without granting renewal access when %s and remains idempotent after the boundary',
  async (order) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2030-01-10T00:17:37Z'));
    try {
      const f = futureRenewalFixture();
      const candidate = f.rows.get('source')!;
      candidate.createdAt = new Date('2030-01-10T00:13:06Z');
      f.subscriptionRepo.findOne.mockImplementation(({ where }) => {
        const binding = where as {
          id?: string;
          providerSubscriptionId?: string;
        };
        const row = binding.id
          ? f.rows.get(binding.id)
          : [...f.rows.values()].find(
              (value) =>
                value.providerSubscriptionId === binding.providerSubscriptionId,
            );
        return Promise.resolve(row ? structuredClone(row) : null);
      });
      const paidAt = '2030-01-10T00:16:57Z';
      f.snapshot.billingInfo = {
        last_payment: { time: paidAt },
        next_billing_time: '2030-01-10T10:00:00Z',
      };
      Object.assign(f.snapshot.raw, {
        status: 'ACTIVE',
        billing_info: f.snapshot.billingInfo,
      });
      const transactions = jest.fn(() =>
        Promise.resolve({
          transactions: [
            {
              id: 'EARLY-499',
              status: 'COMPLETED',
              time: paidAt,
              amount_with_breakdown: {
                gross_amount: { value: '499.00', currency_code: 'MXN' },
              },
            },
          ],
        }),
      );
      Object.assign(f.paypal, { getSubscriptionTransactions: transactions });
      const before = structuredClone({
        source: f.prior,
        license: f.licenses.get(f.prior.id),
      });
      const processor = new BillingSubscriptionPaymentsProcessorService(
        f.paypal as never,
        new BillingLicenseCalculatorService(new BillingPlanCatalogResolver()),
        f.audit as never,
      );
      const webhook = () =>
        processor.process(f.manager as never, {
          eventId: 'early-webhook',
          providerEventId: 'WH-EARLY',
          eventType: 'PAYMENT.SALE.COMPLETED',
          resource: {
            id: 'EARLY-499',
            billing_agreement_id: candidate.providerSubscriptionId,
            create_time: paidAt,
            amount: { total: '499.00', currency: 'MXN' },
          },
        });
      if (order === 'webhook-first') await webhook();
      await f.service().reconcileRenewalResume(candidate.id);
      if (order === 'recovery-first') await webhook();
      await f.service().reconcileRenewalResume(candidate.id);
      jest.setSystemTime(new Date(boundary));
      await f.service().reconcileRenewalResume(candidate.id);
      await webhook();
      expect(transactions).toHaveBeenCalledWith(
        candidate.providerSubscriptionId,
        candidate.createdAt.toISOString(),
        expect.any(String),
      );
      expect(f.payments).toHaveLength(1);
      expect(f.payments[0]).toMatchObject({
        providerCaptureId: 'EARLY-499',
        status: 'paid',
        amount: '499.00',
        currency: 'MXN',
        metadata: {
          renewalResumeReview: {
            state: 'required',
            reason: 'unexpected_payment',
          },
        },
      });
      expect(f.rows.get(candidate.id)).toMatchObject({
        status: SubscriptionStatus.Pending,
        metadata: { renewalResume: { state: 'scheduled' } },
      });
      expect(
        f.rows.get(candidate.id)!.metadata.renewalResume,
      ).not.toHaveProperty('paidCaptureId');
      expect(f.licenses.has(candidate.id)).toBe(false);
      expect(
        structuredClone({
          source: f.rows.get(f.prior.id),
          license: f.licenses.get(f.prior.id),
        }),
      ).toEqual(before);
      expect(f.paypal.createOrder).not.toHaveBeenCalled();
      expect(f.paypal.captureOrder).not.toHaveBeenCalled();
      expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  },
);
it('an approved future renewal can be discarded without cancelling the old paid contract or license',async()=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10'));
  try {
    const f=futureRenewalFixture();await f.service().recoverManagement();
    const before=structuredClone({prior:f.prior,license:f.licenses.get(f.prior.id)});
    expect(await f.service().cancelPendingCheckout(f.checkoutId,f.buyer,actor)).toEqual({cancelled:true,abandoned:true});
    await f.service().reconcileAbandonedCheckout('source');
    expect(f.paypal.cancelSubscription).toHaveBeenCalledWith(expect.objectContaining({providerSubscriptionId:'I-ONE'}));
    expect(f.rows.get(f.prior.id)).toEqual(before.prior);expect(f.licenses.get(f.prior.id)).toEqual(before.license);
    expect(f.payments).toHaveLength(0);
  }finally{jest.useRealTimers()}
});

it('revises only the already authorized future agreement, preserves its old price until consent and restores it on cancellation',async()=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10'));
  try{
    const f=futureRenewalFixture();await f.service().recoverManagement();
    Object.assign(f.paypal,{getPlan:jest.fn(async()=>({status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{value:f.target.price.amount,currency_code:'MXN'}}}],payment_preferences:{setup_fee:{value:'0'}}}))});
    const before=structuredClone({source:f.prior,license:f.licenses.get(f.prior.id)});
    const first=await f.service().changeRenewalPlan(f.prior.id,'source',changeDto,actor);
    expect(first.renewalPlanChange).toMatchObject({state:'awaiting_approval',amountDueNow:'0.00',targetPlanCode:'pro',action:'approve_subscription'});
    expect(f.rows.get('source')!.planCode).toBe('basic');expect((f.rows.get('source')!.metadata.renewalResume as {recurringAmount:string}).recurringAmount).toBe('499.00');
    const reviseCalls=f.paypal.reviseSubscription.mock.calls.length;
    await f.service().changeRenewalPlan(f.prior.id,'source',changeDto,actor);
    expect(f.paypal.reviseSubscription).toHaveBeenCalledTimes(reviseCalls);
    f.snapshot.planId='P-pro';await f.service().recoverManagement();
    expect(f.rows.get('source')).toMatchObject({status:SubscriptionStatus.Pending,planCode:'pro',metadata:{renewalResume:{state:'scheduled',recurringAmount:f.target.price.amount},renewalPlanChange:{state:'scheduled'}}});
    expect(await f.service().getCurrentSubscription('org','balanz_cfdi',actor)).toMatchObject({id:f.prior.id,pendingRenewal:{planCode:'pro'},pendingRenewalPlanChange:{state:'scheduled'}});
    expect(await f.service().cancelRenewalPlanChange(first.checkoutId,'buyer',actor)).toMatchObject({cancelled:false,approvalUrl:'https://www.paypal.com/approve'});
    f.snapshot.planId='P-basic';await f.service().recoverManagement();
    expect(f.rows.get('source')).toMatchObject({status:SubscriptionStatus.Pending,planCode:'basic',metadata:{renewalResume:{state:'scheduled',recurringAmount:'499.00'},renewalPlanChange:{state:'failed'}}});
    expect(f.rows.get(f.prior.id)).toEqual(before.source);expect(f.licenses.get(f.prior.id)).toEqual(before.license);
    expect(f.payments).toHaveLength(0);expect(f.paypal.createOrder).not.toHaveBeenCalled();expect(f.paypal.captureOrder).not.toHaveBeenCalled();expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  }finally{jest.useRealTimers()}
});

it('recovers explicit restoration when an approval arrives after cancelling the future revision',async()=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10'));
  try{
    const f=futureRenewalFixture();await f.service().recoverManagement();
    Object.assign(f.paypal,{getPlan:jest.fn(async()=>({status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{value:f.target.price.amount,currency_code:'MXN'}}}],payment_preferences:{setup_fee:{value:'0'}}}))});
    const first=await f.service().changeRenewalPlan(f.prior.id,'source',changeDto,actor);
    expect(await f.service().cancelRenewalPlanChange(first.checkoutId,'buyer',actor)).toEqual({cancelled:true});
    expect((f.rows.get('source')!.metadata.renewalPlanChange as {state:string}).state).toBe('failed');
    f.snapshot.planId='P-pro';await f.service().recoverManagement();await f.service().recoverManagement();
    expect(f.rows.get('source')).toMatchObject({planCode:'basic',metadata:{renewalPlanChange:{state:'awaiting_approval',cancelRequestedAt:expect.any(String),cancelApprovalUrl:'https://www.paypal.com/approve',cancellationGeneration:1}}});
    const response=await f.service().getCurrentSubscription('org','balanz_cfdi',actor);
    expect(response.pendingRenewalPlanChange).toMatchObject({cancellationRequested:true,action:'approve_subscription',checkoutUrl:'https://www.paypal.com/approve'});
    f.snapshot.planId='P-basic';await f.service().recoverManagement();
    expect((f.rows.get('source')!.metadata.renewalPlanChange as {state:string}).state).toBe('failed');
    expect(f.rows.get(f.prior.id)).toEqual(f.prior);expect(f.payments).toHaveLength(0);expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  }finally{jest.useRealTimers()}
});

it('retains cancelled revision history when a replacement intent exists and recovers restoration under the historical attempt identity',async()=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10'));
  try{
    const f=futureRenewalFixture();await f.service().recoverManagement();
    Object.assign(f.paypal,{getPlan:jest.fn(async()=>({status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{value:f.target.price.amount,currency_code:'MXN'}}}],payment_preferences:{setup_fee:{value:'0'}}}))});
    const old=await f.service().changeRenewalPlan(f.prior.id,'source',changeDto,actor);
    await f.service().cancelRenewalPlanChange(old.checkoutId,'buyer',actor);
    f.target.plan.code='plus';f.target.price.code='plus-monthly';f.target.price.id='plus-price';f.target.provider.providerPriceId='P-plus';
    const nextDto={...changeDto,idempotencyKey:'replacement-key',targetPlanCode:'plus',targetPlanPriceCode:'plus-monthly'};
    const next=await f.service().changeRenewalPlan(f.prior.id,'source',nextDto,actor);
    f.snapshot.planId='P-pro';await f.service().recoverManagement();await f.service().recoverManagement();
    const current=await f.service().getCurrentSubscription('org','balanz_cfdi',actor);
    expect(current.pendingRenewalPlanChange).toMatchObject({attemptId:changeDto.idempotencyKey,targetPlanCode:'pro',cancellationRequested:true,action:'approve_subscription'});
    const replay=await f.service().changeRenewalPlan(f.prior.id,'source',nextDto,actor);
    expect(replay).toMatchObject({checkoutId:next.checkoutId,renewalPlanChange:{state:'failed',targetPlanCode:'plus',action:'none'}});
    expect(f.rows.get('source')!.planCode).toBe('basic');expect(f.rows.get(f.prior.id)).toEqual(f.prior);
    expect(f.payments).toHaveLength(0);expect(f.paypal.createOrder).not.toHaveBeenCalled();expect(f.paypal.captureOrder).not.toHaveBeenCalled();expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  }finally{jest.useRealTimers()}
});
it('an unconfirmed future restoration cannot freeze benefits when the actual target cycle is paid at the boundary',async()=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10'));
  try{
    const f=futureRenewalFixture();await f.service().recoverManagement();
    Object.assign(f.paypal,{getPlan:jest.fn(async()=>({status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{value:f.target.price.amount,currency_code:'MXN'}}}],payment_preferences:{setup_fee:{value:'0'}}}))});
    const first=await f.service().changeRenewalPlan(f.prior.id,'source',changeDto,actor);f.snapshot.planId='P-pro';await f.service().recoverManagement();
    await f.service().cancelRenewalPlanChange(first.checkoutId,'buyer',actor);
    jest.setSystemTime(new Date(boundary));f.snapshot.billingInfo={last_payment:{time:boundary},next_billing_time:'2030-03-01T00:00:00Z'};
    Object.assign(f.paypal,{getSubscriptionTransactions:jest.fn(async()=>({transactions:[{id:'PAID-TARGET',status:'COMPLETED',time:boundary,amount_with_breakdown:{gross_amount:{value:f.target.price.amount,currency_code:'MXN'}}}]}))});
    const calls=f.paypal.reviseSubscription.mock.calls.length;
    await f.service().recoverManagement();
    expect(f.rows.get('source')).toMatchObject({status:SubscriptionStatus.Active,planCode:'pro',metadata:{renewalResume:{state:'effective'},renewalPlanChange:{state:'effective'}}});
    expect((f.rows.get('source')!.metadata.renewalPlanChange as {cancelRequestedAt?:string}).cancelRequestedAt).toBeUndefined();
    expect(f.paypal.reviseSubscription).toHaveBeenCalledTimes(calls);expect(f.payments).toHaveLength(1);expect(f.rows.get(f.prior.id)).toEqual(f.prior);
  }finally{jest.useRealTimers()}
});

it('allows replacing a confirmed scheduled future plan and discarding the new unapproved revision preserves the last authorized plan',async()=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10'));
  try{
    const f=futureRenewalFixture();await f.service().recoverManagement();
    Object.assign(f.paypal,{getPlan:jest.fn(()=>Promise.resolve({status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{value:f.target.price.amount,currency_code:'MXN'}}}],payment_preferences:{setup_fee:{value:'0'}}}))});
    const before=structuredClone({source:f.prior,license:f.licenses.get(f.prior.id)});
    const previous=await f.service().changeRenewalPlan(f.prior.id,'source',changeDto,actor);
    f.snapshot.planId='P-pro';await f.service().recoverManagement();
    const authorizedAmount=f.target.price.amount;
    f.checkouts.set(previous.checkoutId,structuredClone(f.checkouts.get(previous.checkoutId)!));
    const target=catalog('basic');Object.assign(f.target.plan,target.plan);Object.assign(f.target.price,target.price);Object.assign(f.target.provider,target.provider);
    const nextDto={...changeDto,idempotencyKey:'next-after-scheduled',targetPlanCode:'basic',targetPlanPriceCode:'basic-monthly'};
    const prepared=await f.service().changeRenewalPlan(f.prior.id,'source',nextDto,actor);
    expect(prepared.checkoutId).not.toBe(previous.checkoutId);
    expect(prepared.renewalPlanChange).toMatchObject({state:'awaiting_approval',amountDueNow:'0.00',targetPlanCode:'basic'});
    expect(f.rows.get('source')).toMatchObject({planCode:'pro',metadata:{renewalResume:{state:'scheduled',recurringAmount:authorizedAmount},renewalPlanChange:{originalProviderPlanId:'P-pro',originalCheckoutId:previous.checkoutId}}});
    expect(await f.service().cancelRenewalPlanChange(prepared.checkoutId,'buyer',actor)).toEqual({cancelled:true});
    expect(f.rows.get('source')).toMatchObject({planCode:'pro',metadata:{renewalResume:{state:'scheduled',recurringAmount:authorizedAmount},renewalPlanChange:{state:'failed'}}});
    expect(await f.service().changeRenewalPlan(f.prior.id,'source',changeDto,actor)).toMatchObject({checkoutId:previous.checkoutId,renewalPlanChange:{state:'scheduled',targetPlanCode:'pro'}});
    expect(f.rows.get(f.prior.id)).toEqual(before.source);expect(f.licenses.get(f.prior.id)).toEqual(before.license);
    expect(f.payments).toHaveLength(0);expect(f.paypal.createOrder).not.toHaveBeenCalled();expect(f.paypal.captureOrder).not.toHaveBeenCalled();expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  }finally{jest.useRealTimers()}
});

it('recovers the approved future change for cancellation after discarding a later unapproved draft, while both receipts stay bound to their own checkout',async()=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-10'));
  try{
    const f=futureRenewalFixture();
    f.rows.get('source')!.planPrice!.amount='999.00';
    (f.rows.get('source')!.metadata.renewalResume as {recurringAmount:string}).recurringAmount='999.00';
    f.prior.planPrice!.amount='999.00';f.target.price.amount='499.00';
    await f.service().recoverManagement();
    Object.assign(f.paypal,{getPlan:jest.fn(()=>Promise.resolve({status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{value:f.target.price.amount,currency_code:'MXN'}}}],payment_preferences:{setup_fee:{value:'0'}}}))});
    const before=structuredClone({source:f.prior,license:f.licenses.get(f.prior.id)});
    const approved=await f.service().changeRenewalPlan(f.prior.id,'source',changeDto,actor);
    f.snapshot.planId='P-pro';await f.service().recoverManagement();
    f.checkouts.set(approved.checkoutId,structuredClone(f.checkouts.get(approved.checkoutId)!));
    const target=catalog('basic');target.price.amount='999.00';Object.assign(f.target.plan,target.plan);Object.assign(f.target.price,target.price);Object.assign(f.target.provider,target.provider);
    const draft=await f.service().changeRenewalPlan(f.prior.id,'source',{...changeDto,idempotencyKey:'discarded-later-draft',targetPlanCode:'basic',targetPlanPriceCode:'basic-monthly'},actor);
    await f.service().cancelRenewalPlanChange(draft.checkoutId,'buyer',actor);
    const current=await f.service().getCurrentSubscription('org','balanz_cfdi',actor);
    expect(current).toMatchObject({id:f.prior.id,pendingRenewal:{planCode:'pro',recurringAmount:'499.00'},pendingRenewalPlanChange:{attemptId:changeDto.idempotencyKey,checkoutId:approved.checkoutId,state:'scheduled',targetPlanCode:'pro',recurringAmount:'499.00'}});
    expect(f.rows.get('source')!.metadata.renewalPlanChange).toMatchObject({attemptId:'discarded-later-draft',state:'failed'});
    expect((await f.checkoutStatus().getCheckoutStatus(draft.checkoutId,actor)).renewalPlanChange).toMatchObject({state:'failed',targetPlanCode:'basic',checkoutUrl:null});
    expect((await f.checkoutStatus().getCheckoutStatus(approved.checkoutId,actor)).renewalPlanChange).toMatchObject({state:'scheduled',targetPlanCode:'pro',recurringAmount:'499.00'});
    expect(await f.service().cancelRenewalPlanChange(approved.checkoutId,'buyer',actor)).toMatchObject({cancelled:false,approvalUrl:'https://www.paypal.com/approve'});
    expect(f.rows.get('source')).toMatchObject({planCode:'pro',metadata:{renewalPlanChange:{attemptId:changeDto.idempotencyKey,originalProviderPlanId:'P-basic'}}});
    f.snapshot.planId='P-basic';await f.service().recoverManagement();
    expect(f.rows.get('source')).toMatchObject({planCode:'basic',metadata:{renewalResume:{recurringAmount:'999.00'}}});
    expect((await f.checkoutStatus().getCheckoutStatus(draft.checkoutId,actor)).renewalPlanChange).toMatchObject({state:'failed',checkoutUrl:null});
    expect(f.rows.get(f.prior.id)).toEqual(before.source);expect(f.licenses.get(f.prior.id)).toEqual(before.license);
    expect(f.payments).toHaveLength(0);expect(f.paypal.createOrder).not.toHaveBeenCalled();expect(f.paypal.captureOrder).not.toHaveBeenCalled();expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  }finally{jest.useRealTimers()}
});
