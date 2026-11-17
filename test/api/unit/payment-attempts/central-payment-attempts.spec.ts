import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BillingPaymentAttemptsService } from '../../../../apps/api/src/modules/payment-attempts/billing-payment-attempts.service';
import { BillingPaymentAttemptEntity } from '../../../../apps/api/src/modules/payment-attempts/billing-payment-attempt.entity';
import { CreatePaymentAttemptDto } from '../../../../apps/api/src/modules/payment-attempts/payment-attempt.dto';
import { BillingCheckoutService } from '../../../../apps/api/src/modules/checkout';
import { BillingSubscriptionsManagementService } from '../../../../apps/api/src/modules/subscriptions-management/billing-subscriptions-management.service';
import { BillingServicePolicyService } from '../../../../apps/api/src/common/services/billing-service-policy.service';
import { CheckoutInProgressException } from '../../../../apps/api/src/modules/checkout/errors/checkout-in-progress.exception';
import {
  BillingCheckoutSessionEntity,
  BillingCheckoutSessionStatus,
  BillingProvider,
  BillingSubscriptionEntity,
  SubscriptionStatus,
} from '../../../../apps/api/src/modules/billing-shared';

const actor = { issuer: 'https://identity.test', clientId: 'node-service' };
const scopes = [
  'billing.integration.checkout.create',
  'billing.subscriptions.manage',
];
function fixture(popup = false) {
  const rows = new Map<string, BillingPaymentAttemptEntity>();
  const input: CreatePaymentAttemptDto = {
    idempotencyKey: randomUUID(),
    organizationId: randomUUID(),
    userId: randomUUID(),
    productCode: 'balanz_cfdi',
    planCode: 'basic',
    planPriceCode: 'basic-monthly',
    successUrl: 'https://consumer.test/return',
    cancelUrl: 'https://consumer.test/cancel',
  };
  const checkoutId = randomUUID(),
    subscriptionId = randomUUID();
  const repository = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(structuredClone(rows.get(where.id) ?? null)),
    ),
    find: jest.fn(() =>
      Promise.resolve(
        [...rows.values()]
          .filter((row) => row.status === 'pending')
          .map((row) => structuredClone(row)),
      ),
    ),
    create: (row: Partial<BillingPaymentAttemptEntity>) =>
      Object.assign(new BillingPaymentAttemptEntity(), row),
    save: jest.fn((row: BillingPaymentAttemptEntity) => {
      row.updatedAt = new Date();
      rows.set(row.id, structuredClone(row));
      return Promise.resolve(row);
    }),
    update: jest.fn(
      (id: string, patch: Partial<BillingPaymentAttemptEntity>) => {
        Object.assign(rows.get(id)!, patch);
        return Promise.resolve({ affected: 1 });
      },
    ),
  };
  const committedSignals: unknown[][] = [];
  let stagedSignals: unknown[][] | null = null;
  let rejectReadyCommit = false;
  const domainQuery = jest.fn<
    Promise<Array<{ id: string }>>,
    [sql?: string, params?: unknown[]]
  >((sql, params = []) => {
    if (sql?.includes('queue_billing_license')) {
      if (!stagedSignals)
        throw new Error('Outbox queue must share the receipt transaction');
      expect(rows.get(input.idempotencyKey)?.status).toBe('ready');
      stagedSignals.push(params);
    }
    return Promise.resolve([]);
  });
  const popupSubscription = {
    id: subscriptionId,
    organizationId: input.organizationId,
    productCode: input.productCode,
    provider: BillingProvider.Paypal,
    status: SubscriptionStatus.Pending,
    providerSubscriptionId: 'I-OWNED123',
    metadata: {},
  };
  const popupCheckout = {
    id: checkoutId,
    organizationId: input.organizationId,
    productCode: input.productCode,
    userId: input.userId,
    provider: BillingProvider.Paypal,
    status: BillingCheckoutSessionStatus.Created,
    providerCheckoutUrl: 'https://www.sandbox.paypal.com/approve',
    metadata: {
      subscriptionId,
      createdByIssuer: actor.issuer,
      createdByClientId: actor.clientId,
    },
  };
  const paypalConnections = {
    approvalConfiguration: jest.fn<
      Promise<{ clientId: string; environment: 'sandbox' }>,
      [string | null]
    >(() =>
      Promise.resolve({
        clientId: 'public-app',
        environment: 'sandbox',
      }),
    ),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === BillingSubscriptionEntity
        ? {
            findOne: () =>
              Promise.resolve(
                popup
                  ? popupSubscription
                  : { provider: BillingProvider.Paypal },
              ),
          }
        : popup && entity === BillingCheckoutSessionEntity
          ? { findOne: () => Promise.resolve(popupCheckout) }
          : repository,
    query: domainQuery,
  } as unknown as EntityManager;
  let queue: Promise<unknown> = Promise.resolve();
  const dataSource = {
    manager,
    getRepository: () => repository,
    transaction: <T>(work: (m: EntityManager) => Promise<T>) => {
      const result = queue.then(async () => {
        const before = structuredClone(rows);
        stagedSignals = [];
        try {
          const result = await work(manager);
          if (rejectReadyCommit && stagedSignals.length)
            throw new Error('Commit rejected');
          committedSignals.push(...stagedSignals);
          return result;
        } catch (error) {
          rows.clear();
          for (const [id, row] of before) rows.set(id, row);
          throw error;
        } finally {
          stagedSignals = null;
        }
      });
      queue = result.catch(() => undefined);
      return result;
    },
  } as unknown as DataSource;
  const resolveProviderConnection = jest.fn((): Promise<string | null> =>
    Promise.resolve(null),
  );
  const checkout = {
    resolveCheckoutSelection: jest.fn(async () => ({
      providerPriceMappingId: 'mapping-id',
      providerConnectionId: await resolveProviderConnection(),
    })),
    validateApprovalUrl: (_provider: BillingProvider, value: string) => value,
    resolveProviderConnection,
    resolveCheckoutProvider: jest.fn(() =>
      Promise.resolve(BillingProvider.Paypal),
    ),
    createCheckoutSession: jest.fn(() =>
      Promise.resolve({
        checkoutId,
        subscriptionId,
        checkoutUrl: popup
          ? popupCheckout.providerCheckoutUrl
          : 'https://www.paypal.com/approve',
        status: BillingCheckoutSessionStatus.Created,
      }),
    ),
    getCheckoutStatus: jest.fn(() =>
      Promise.resolve({
        checkoutId,
        subscriptionId,
        checkoutStatus: BillingCheckoutSessionStatus.Approved,
        subscriptionStatus: SubscriptionStatus.Active,
        provider: BillingProvider.Paypal,
        planChange:
          undefined as import('../../../../apps/api/src/modules/checkout/dtos').CheckoutSessionStatusResponseDto['planChange'],
      }),
    ),
  };
  const subscriptions = {
    cancelPendingCheckout: jest.fn(() => Promise.resolve({ cancelled: true })),
    cancelPlanChange: jest.fn(() =>
      Promise.resolve({ cancelled: true } as {
        cancelled: boolean;
        approvalUrl?: string;
      }),
    ),
    getCurrentSubscription: jest.fn(() =>
      Promise.resolve({ id: subscriptionId }),
    ),
    changePlan: jest.fn(() =>
      Promise.resolve({
        checkoutId,
        newSubscriptionId: subscriptionId,
        checkoutUrl: 'https://www.paypal.com/revise',
        subscription: { status: SubscriptionStatus.Active },
        state: 'awaiting_approval',
        planChange: {
          state: 'awaiting_approval' as const,
          effectiveAt: '2030-01-01T00:00:00Z',
          action: 'approve_subscription' as const,
          checkoutUrl: 'https://www.paypal.com/revise',
        },
      }),
    ),
    verifyCheckoutSession: jest.fn(() =>
      Promise.resolve({
        checkoutId,
        subscriptionId,
        checkoutStatus: BillingCheckoutSessionStatus.Pending,
        subscriptionStatus: SubscriptionStatus.Active,
        planChange: {
          state: 'awaiting_approval' as const,
          effectiveAt: '2030-01-01T00:00:00Z',
          action: 'approve_payment' as const,
          checkoutUrl: null,
        },
      }),
    ),
  };
  const policy = {
    assertContext: jest.fn(() => Promise.resolve()),
    assertReturnUrls: jest.fn(() => Promise.resolve()),
  };
  const service = () =>
    new BillingPaymentAttemptsService(
      dataSource,
      checkout as unknown as BillingCheckoutService,
      subscriptions as unknown as BillingSubscriptionsManagementService,
      policy as unknown as BillingServicePolicyService,
      paypalConnections as never,
    );
  const change = () => ({
    ...input,
    operation: 'change_plan' as const,
    expectedSubscriptionId: subscriptionId,
    expectedAmountDueNow: '150.00',
  });
  return {
    rows,
    committedSignals,
    rejectNextReadyCommit: () => {
      rejectReadyCommit = true;
    },
    paypalConnections,
    popupSubscription,
    popupCheckout,
    input,
    checkoutId,
    subscriptionId,
    checkout,
    subscriptions,
    policy,
    service,
    change,
    repository,
    domainQuery,
  };
}

describe('central durable payment attempts', () => {
  it('acknowledges a slow checkout and exposes the same approval link after preparation', async () => {
    jest.useFakeTimers();
    try {
      const f = fixture();
      const service = f.service();
      const approvalUrl = 'https://www.paypal.com/approve';
      f.checkout.createCheckoutSession.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  checkoutId: f.checkoutId,
                  subscriptionId: f.subscriptionId,
                  checkoutUrl: approvalUrl,
                  status: BillingCheckoutSessionStatus.Created,
                }),
              6_000,
            );
          }),
      );
      const request = service.create(f.input, actor, scopes);
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(request).resolves.toMatchObject({
        attemptId: f.input.idempotencyKey,
        status: 'processing',
      });
      await expect(
        service.create(f.input, actor, scopes),
      ).resolves.toMatchObject({
        attemptId: f.input.idempotencyKey,
        status: 'processing',
      });
      expect(f.committedSignals).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(5_000);
      expect(f.committedSignals).toEqual([
        [f.input.organizationId, f.input.productCode],
      ]);
      await expect(
        service.get(f.input.idempotencyKey, f.input, actor),
      ).resolves.toMatchObject({
        attemptId: f.input.idempotencyKey,
        status: 'ready',
        checkoutUrl: approvalUrl,
      });
      expect(f.rows.size).toBe(1);
      expect(f.checkout.createCheckoutSession).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  it.each(['absent', 'present', 'unavailable'])(
    'projects a read-only preparation rejection only with verified absent artifacts (%s)',
    async (evidence) => {
      const f = fixture();
      const row = Object.assign(new BillingPaymentAttemptEntity(), {
        id: f.input.idempotencyKey,
        organizationId: f.input.organizationId,
        userId: f.input.userId,
        productCode: f.input.productCode,
        createdByIssuer: actor.issuer,
        createdByClientId: actor.clientId,
        requestPayload: {
          ...f.input,
          operation: 'change_renewal_plan',
          expectedSubscriptionId: f.subscriptionId,
          expectedRenewalSubscriptionId: f.subscriptionId,
        },
        status: 'rejected',
        receipt: { statusFresh: false, errorCode: 'BILLING_CHECKOUT_REJECTED' },
        leaseToken: null,
        leaseUntil: null,
      });
      f.rows.set(row.id, structuredClone(row));
      const before = structuredClone(f.rows.get(row.id));
      if (evidence === 'present')
        f.domainQuery.mockResolvedValueOnce([
          { id: 'soft-deleted-domain-artifact' },
        ]);
      if (evidence === 'unavailable')
        f.domainQuery.mockRejectedValueOnce(
          new Error('database read unavailable'),
        );
      const response = await f.service().get(row.id, f.input, actor);
      expect(response).toMatchObject({
        status: 'rejected',
        statusFresh: evidence === 'absent',
        errorCode:
          evidence === 'absent'
            ? 'BILLING_CHECKOUT_REJECTED_BEFORE_PREPARATION'
            : 'BILLING_CHECKOUT_REJECTED',
      });
      expect(f.domainQuery).toHaveBeenCalledWith(
        expect.not.stringContaining('deleted_at'),
        [
          row.organizationId,
          row.productCode,
          row.id,
          actor.issuer,
          actor.clientId,
        ],
      );
      expect(f.rows.get(row.id)).toEqual(before);
      expect(f.repository.save).not.toHaveBeenCalled();
      expect(f.checkout.createCheckoutSession).not.toHaveBeenCalled();
    },
  );
  it('binds a future plan change to both contracts and reopens only a canonical restoration after cancellation', async () => {
    const f = fixture(),
      candidateId = randomUUID();
    const input = {
      ...f.input,
      operation: 'change_renewal_plan' as const,
      expectedSubscriptionId: f.subscriptionId,
      expectedRenewalSubscriptionId: candidateId,
    };
    const change = {
      state: 'awaiting_approval',
      sourceSubscriptionId: f.subscriptionId,
      renewalSubscriptionId: candidateId,
      targetPlanCode: input.planCode,
      targetPlanPriceCode: input.planPriceCode,
      effectiveAt: '2030-02-01T00:00:00Z',
      amountDueNow: '0.00',
      recurringAmount: '499.00',
      currency: 'MXN',
      cancellationRequested: false,
      action: 'approve_subscription',
      checkoutUrl: 'https://www.paypal.com/revise-future',
    };
    const request = jest.fn(() =>
      Promise.resolve({
        checkoutId: f.checkoutId,
        renewalPlanChange: change,
      }),
    );
    const cancel = jest.fn(() => Promise.resolve({ cancelled: true }));
    Object.assign(f.subscriptions, {
      changeRenewalPlan: request,
      cancelRenewalPlanChange: cancel,
    });
    await expect(
      f.service().create(input, actor, ['billing.integration.checkout.create']),
    ).rejects.toMatchObject({ status: 403 });
    f.subscriptions.getCurrentSubscription.mockImplementation(
      (...args: unknown[]) =>
        Promise.resolve(
          args[2] === actor
            ? {
                id: f.subscriptionId,
                pendingRenewal: { subscriptionId: candidateId },
              }
            : { id: f.subscriptionId },
        ),
    );
    expect(await f.service().create(input, actor, scopes)).toMatchObject({
      operation: 'change_renewal_plan',
      subscriptionId: candidateId,
      renewalPlanChange: { amountDueNow: '0.00' },
    });
    expect(request).toHaveBeenCalledWith(
      f.subscriptionId,
      candidateId,
      expect.objectContaining({ targetPlanCode: input.planCode }),
      actor,
    );
    expect(f.checkout.createCheckoutSession).not.toHaveBeenCalled();
    expect(f.subscriptions.changePlan).not.toHaveBeenCalled();
    await f.service().cancel(input.idempotencyKey, input, actor);
    expect(cancel).toHaveBeenCalledWith(f.checkoutId, input.userId, actor);
    expect(f.rows.get(input.idempotencyKey)).toMatchObject({
      status: 'rejected',
      receipt: {
        errorCode: 'PAYMENT_ATTEMPT_CANCELLED',
        renewalPlanChange: { state: 'failed' },
      },
    });
    f.checkout.getCheckoutStatus.mockResolvedValueOnce({
      checkoutId: f.checkoutId,
      subscriptionId: candidateId,
      provider: BillingProvider.Paypal,
      checkoutStatus: 'pending',
      subscriptionStatus: 'pending',
      renewalPlanChange: {
        ...change,
        cancellationRequested: true,
        checkoutUrl: 'https://www.paypal.com/restore-future',
      },
    });
    const restored = await f.service().get(input.idempotencyKey, input, actor);
    expect(restored).toMatchObject({
      status: 'ready',
      renewalPlanChange: { cancellationRequested: true },
      checkoutUrl: 'https://www.paypal.com/restore-future',
    });
    expect(restored.errorCode).toBeUndefined();
  });
  it('future renewal requires management scope and preserves the source plus durable new candidate receipt', async () => {
    const f = fixture();
    const nextId = randomUUID();
    const input = {
      ...f.input,
      operation: 'resume_renewal' as const,
      expectedSubscriptionId: f.subscriptionId,
    };
    await expect(
      f.service().create(input, actor, ['billing.integration.checkout.create']),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.checkout.createCheckoutSession).not.toHaveBeenCalled();
    await expect(
      f
        .service()
        .create({ ...input, expectedAmountDueNow: '1.00' }, actor, scopes),
    ).rejects.toMatchObject({ status: 400 });
    const renewalResume = {
      state: 'awaiting_approval',
      sourceSubscriptionId: f.subscriptionId,
      effectiveAt: '2030-02-01T00:00:00Z',
      amountDueNow: '0.00',
      recurringAmount: '999.00',
      currency: 'MXN',
    };
    f.checkout.createCheckoutSession.mockResolvedValueOnce({
      checkoutId: f.checkoutId,
      subscriptionId: nextId,
      checkoutUrl: 'https://www.paypal.com/approve',
      status: BillingCheckoutSessionStatus.Created,
    });
    f.checkout.getCheckoutStatus.mockResolvedValueOnce({
      checkoutId: f.checkoutId,
      subscriptionId: nextId,
      checkoutStatus: BillingCheckoutSessionStatus.Created,
      subscriptionStatus: SubscriptionStatus.Pending,
      provider: BillingProvider.Paypal,
      renewalResume,
    });
    const created = await f.service().create(input, actor, scopes);
    expect(created).toMatchObject({
      operation: 'resume_renewal',
      subscriptionId: nextId,
      renewalResume,
      checkoutUrl: 'https://www.paypal.com/approve',
    });
    expect(f.checkout.createCheckoutSession.mock.calls[0][0]).toMatchObject({
      resumeSourceSubscriptionId: f.subscriptionId,
    });
    expect(f.subscriptions.changePlan).not.toHaveBeenCalled();
    f.checkout.getCheckoutStatus.mockResolvedValueOnce({
      checkoutId: f.checkoutId,
      subscriptionId: nextId,
      checkoutStatus: BillingCheckoutSessionStatus.Approved,
      subscriptionStatus: SubscriptionStatus.Pending,
      provider: BillingProvider.Paypal,
      renewalResume: { ...renewalResume, state: 'scheduled' },
    });
    expect(
      await f.service().get(input.idempotencyKey, input, actor),
    ).toMatchObject({
      renewalResume: { state: 'scheduled' },
      checkoutUrl: undefined,
    });
    await f.service().cancel(input.idempotencyKey, input, actor);
    expect(f.subscriptions.cancelPendingCheckout).toHaveBeenCalledWith(
      f.checkoutId,
      input,
      actor,
    );
    expect(f.subscriptions.cancelPlanChange).not.toHaveBeenCalled();
  });
  it('reserves the caller-known ID and immutable payload centrally before calling the checkout engine', async () => {
    const f = fixture();
    f.checkout.createCheckoutSession.mockImplementationOnce(() => {
      expect(f.rows.get(f.input.idempotencyKey)).toMatchObject({
        userId: f.input.userId,
        requestPayload: { ...f.input, operation: 'checkout' },
        leaseToken: expect.any(String) as string,
      });
      return Promise.resolve({
        checkoutId: f.checkoutId,
        subscriptionId: f.subscriptionId,
        checkoutUrl: 'https://www.paypal.com/approve',
        status: BillingCheckoutSessionStatus.Created,
      });
    });
    const created = await f.service().create(f.input, actor, scopes);
    expect(created).toMatchObject({
      attemptId: f.input.idempotencyKey,
      operation: 'checkout',
      status: 'ready',
      statusFresh: false,
    });
    expect(
      (await f.service().get(created.attemptId, f.input, actor)).statusFresh,
    ).toBe(true);
  });
  it('canonicalizes uppercase UUIDs before reservation, ownership checks and replay hashing', async () => {
    const f = fixture();
    const uppercase = {
      ...f.input,
      idempotencyKey: f.input.idempotencyKey.toUpperCase(),
      organizationId: f.input.organizationId.toUpperCase(),
      userId: f.input.userId.toUpperCase(),
    };
    expect(await f.service().create(uppercase, actor, scopes)).toMatchObject({
      attemptId: f.input.idempotencyKey,
      status: 'ready',
    });
    expect(
      await f.service().get(uppercase.idempotencyKey, uppercase, actor),
    ).toMatchObject({ attemptId: f.input.idempotencyKey });
    await f.service().create(f.input, actor, scopes);
    expect(f.checkout.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(f.rows.get(f.input.idempotencyKey)).toMatchObject({
      organizationId: f.input.organizationId,
      userId: f.input.userId,
    });
  });
  it('binds retries to every original input field including buyer, plan and both URLs', async () => {
    const f = fixture();
    await f.service().create(f.input, actor, scopes);
    for (const patch of [
      { planPriceCode: 'other' },
      { successUrl: 'https://consumer.test/other' },
      { cancelUrl: 'https://consumer.test/other' },
    ])
      await expect(
        f.service().create({ ...f.input, ...patch }, actor, scopes),
      ).rejects.toMatchObject({ status: 409 });
    expect(f.checkout.createCheckoutSession).toHaveBeenCalledTimes(1);
  });
  it('rejects other users, organizations, products and clients on every attempt operation', async () => {
    const f = fixture();
    await f.service().create(f.change(), actor, scopes);
    for (const changed of [
      { ...f.input, userId: randomUUID() },
      { ...f.input, organizationId: randomUUID() },
      { ...f.input, productCode: 'other' },
    ]) {
      await expect(
        f.service().get(f.input.idempotencyKey, changed, actor),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        f.service().retry(f.input.idempotencyKey, changed, actor, scopes),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        f.service().confirm(f.input.idempotencyKey, changed, actor),
      ).rejects.toMatchObject({ status: 404 });
    }
    for (const changed of [
      { ...actor, clientId: 'other' },
      { ...actor, issuer: 'https://other.test' },
    ])
      await expect(
        f.service().confirm(f.input.idempotencyKey, f.input, changed),
      ).rejects.toMatchObject({ status: 404 });
    expect(f.subscriptions.verifyCheckoutSession).not.toHaveBeenCalled();
  });
  it('requires subscription scope for both new changes and retrying their stored payload', async () => {
    const f = fixture();
    await expect(
      f.service().create(f.change(), actor, []),
    ).rejects.toMatchObject({ status: 403 });
    await f.service().create(f.change(), actor, scopes);
    await expect(
      f.service().retry(f.input.idempotencyKey, f.input, actor, []),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('keeps uncertain checkout failures pending and recovers the same frozen intent after process restart', async () => {
    const f = fixture();
    f.checkout.createCheckoutSession.mockRejectedValueOnce(
      new BadGatewayException('response lost'),
    );
    expect(await f.service().create(f.input, actor, scopes)).toMatchObject({
      status: 'pending',
      retryAfterSeconds: 5,
    });
    await f.service().recoverPending();
    expect(f.rows.get(f.input.idempotencyKey)?.status).toBe('ready');
    expect(f.checkout.createCheckoutSession.mock.calls[0]).toEqual(
      f.checkout.createCheckoutSession.mock.calls[1],
    );
  });
  it('serializes concurrent retries without another downstream checkout request', async () => {
    const f = fixture();
    f.checkout.createCheckoutSession.mockRejectedValueOnce(
      new BadGatewayException('offline'),
    );
    await f.service().create(f.input, actor, scopes);
    let release:
      | ((
          value: Awaited<ReturnType<typeof f.checkout.createCheckoutSession>>,
        ) => void)
      | undefined;
    f.checkout.createCheckoutSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = f
      .service()
      .retry(f.input.idempotencyKey, f.input, actor, scopes);
    while (!release) await Promise.resolve();
    expect(
      await f.service().retry(f.input.idempotencyKey, f.input, actor, scopes),
    ).toMatchObject({ status: 'processing' });
    release({
      checkoutId: f.checkoutId,
      subscriptionId: f.subscriptionId,
      checkoutUrl: 'https://www.paypal.com/approve',
      status: BillingCheckoutSessionStatus.Created,
    });
    await first;
    expect(f.checkout.createCheckoutSession).toHaveBeenCalledTimes(2);
  });
  it('recovers an uncertain change on its original subscription even if another becomes current', async () => {
    const f = fixture();
    f.subscriptions.changePlan.mockRejectedValueOnce(
      new BadGatewayException('response lost'),
    );
    await f.service().create(f.change(), actor, scopes);
    f.subscriptions.getCurrentSubscription.mockResolvedValue({
      id: randomUUID(),
    });
    expect(
      await f.service().retry(f.input.idempotencyKey, f.input, actor, scopes),
    ).toMatchObject({ status: 'ready', subscriptionId: f.subscriptionId });
    expect(f.subscriptions.getCurrentSubscription).toHaveBeenCalledTimes(1);
  });
  it('does not verify or capture from GET and suppresses an obsolete subscription redirect', async () => {
    const f = fixture();
    await f.service().create(f.change(), actor, scopes);
    f.checkout.getCheckoutStatus.mockResolvedValue({
      checkoutId: f.checkoutId,
      subscriptionId: f.subscriptionId,
      checkoutStatus: BillingCheckoutSessionStatus.Pending,
      subscriptionStatus: SubscriptionStatus.Active,
      provider: BillingProvider.Paypal,
      planChange: {
        state: 'awaiting_approval',
        effectiveAt: '2030-01-01T00:00:00Z',
        action: 'approve_payment',
        checkoutUrl: null,
      },
    });
    const result = await f
      .service()
      .get(f.input.idempotencyKey, f.input, actor);
    expect(result.checkoutUrl).toBeUndefined();
    expect(f.subscriptions.verifyCheckoutSession).not.toHaveBeenCalled();
    expect(
      (await f.service().confirm(f.input.idempotencyKey, f.input, actor))
        .checkoutUrl,
    ).toBeUndefined();
    expect(f.subscriptions.verifyCheckoutSession).toHaveBeenCalledTimes(1);
  });
  it('rechecks policy and callback origins before reading or continuing stored attempts', async () => {
    const f = fixture();
    await f.service().create(f.change(), actor, scopes);
    f.policy.assertReturnUrls.mockRejectedValueOnce(
      new ForbiddenException('origin revoked'),
    );
    await expect(
      f.service().confirm(f.input.idempotencyKey, f.input, actor),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.subscriptions.verifyCheckoutSession).not.toHaveBeenCalled();
    f.policy.assertContext.mockRejectedValueOnce(
      new ForbiddenException('service revoked'),
    );
    await expect(
      f.service().get(f.input.idempotencyKey, f.input, actor),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('returns a terminal rejected receipt for definitive validation errors and preserves processing hints', async () => {
    const f = fixture();
    f.checkout.createCheckoutSession.mockRejectedValueOnce(
      new CheckoutInProgressException(f.checkoutId, 5),
    );
    expect(await f.service().create(f.input, actor, scopes)).toMatchObject({
      status: 'processing',
      errorCode: 'CHECKOUT_IN_PROGRESS',
    });
    f.checkout.createCheckoutSession.mockRejectedValueOnce(
      new BadRequestException(),
    );
    expect(
      await f.service().retry(f.input.idempotencyKey, f.input, actor, scopes),
    ).toMatchObject({ status: 'rejected' });
    await f.service().retry(f.input.idempotencyKey, f.input, actor, scopes);
    expect(f.checkout.createCheckoutSession).toHaveBeenCalledTimes(2);
  });
});

describe('frozen provider selection', () => {
  it('retains its original provider and financial key after an uncertain response and catalog change', async () => {
    const f = fixture();
    const pinned = randomUUID();
    f.checkout.resolveProviderConnection.mockResolvedValue(pinned);
    f.checkout.createCheckoutSession.mockRejectedValueOnce(
      new BadGatewayException(),
    );
    const pending = await f.service().create(f.input, actor, scopes);
    expect(pending).toMatchObject({
      status: 'pending',
      provider: BillingProvider.Paypal,
    });
    f.checkout.resolveCheckoutProvider.mockRejectedValue(
      new BadRequestException('Catalog changed'),
    );
    f.checkout.resolveProviderConnection.mockResolvedValue(randomUUID());
    const ready = await f
      .service()
      .retry(f.input.idempotencyKey, f.input, actor, scopes);
    expect(ready).toMatchObject({
      status: 'ready',
      provider: BillingProvider.Paypal,
    });
    expect(f.checkout.resolveCheckoutProvider).toHaveBeenCalledTimes(1);
    expect(f.checkout.createCheckoutSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: BillingProvider.Paypal,
        idempotencyKey: f.input.idempotencyKey,
      }),
      actor,
      { providerConnectionId: pinned, providerPriceMappingId: 'mapping-id' },
    );
    expect(f.checkout.resolveProviderConnection).toHaveBeenCalledTimes(1);
    expect(
      f.rows.get(f.input.idempotencyKey)?.requestPayload.providerConnectionId,
    ).toBe(pinned);
  });
  it('recovers provider from authoritative status for a historical ready attempt without selection metadata', async () => {
    const f = fixture();
    await f.service().create(f.input, actor, scopes);
    delete f.rows.get(f.input.idempotencyKey)!.requestPayload.provider;
    expect(
      await f.service().get(f.input.idempotencyKey, f.input, actor),
    ).toMatchObject({ provider: BillingProvider.Paypal });
    expect(f.checkout.createCheckoutSession).toHaveBeenCalledTimes(1);
  });
});

it('does not redirect to a stale approval link after confirmation fails', async () => {
  const f = fixture();
  await f.service().create(f.change(), actor, scopes);
  f.subscriptions.verifyCheckoutSession.mockRejectedValueOnce(
    new BadGatewayException('Provider unavailable'),
  );
  const result = await f
    .service()
    .confirm(f.input.idempotencyKey, f.input, actor);
  expect(result.errorCode).toBe('BILLING_TEMPORARILY_UNAVAILABLE');
  expect(result.checkoutUrl).toBeUndefined();
  expect(result.planChange?.checkoutUrl).toBeNull();
});

describe('cancel payment attempts', () => {
  it('makes cancellation terminal and prevents old confirm or retry from reviving it', async () => {
    const f = fixture();
    await f.service().create(f.change(), actor, scopes);
    expect(
      await f.service().cancel(f.input.idempotencyKey, f.input, actor),
    ).toEqual({ cancelled: true });
    expect(
      await f.service().cancel(f.input.idempotencyKey, f.input, actor),
    ).toEqual({ cancelled: true });
    expect(f.subscriptions.cancelPlanChange).toHaveBeenCalledTimes(1);
    expect(
      await f.service().retry(f.input.idempotencyKey, f.input, actor, scopes),
    ).toMatchObject({
      status: 'rejected',
      checkoutStatus: 'cancelled',
      errorCode: 'PAYMENT_ATTEMPT_CANCELLED',
    });
    await expect(
      f.service().confirm(f.input.idempotencyKey, f.input, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.subscriptions.verifyCheckoutSession).not.toHaveBeenCalled();
  });
  it('keeps the current intent while PayPal approval is still required', async () => {
    const f = fixture();
    await f.service().create(f.change(), actor, scopes);
    f.subscriptions.cancelPlanChange.mockResolvedValueOnce({
      cancelled: false,
      approvalUrl: 'https://www.paypal.com/restore',
    });
    expect(
      await f.service().cancel(f.input.idempotencyKey, f.input, actor),
    ).toEqual({
      cancelled: false,
      approvalUrl: 'https://www.paypal.com/restore',
    });
    expect(f.rows.get(f.input.idempotencyKey)?.status).toBe('ready');
    expect(f.rows.get(f.input.idempotencyKey)?.leaseToken).toBeNull();
  });
  it('checks ownership and cannot cancel another buyer or organization', async () => {
    const f = fixture();
    await f.service().create(f.change(), actor, scopes);
    for (const patch of [
      { userId: randomUUID() },
      { organizationId: randomUUID() },
    ])
      await expect(
        f
          .service()
          .cancel(f.input.idempotencyKey, { ...f.input, ...patch }, actor),
      ).rejects.toMatchObject({ status: 404 });
    expect(f.subscriptions.cancelPlanChange).not.toHaveBeenCalled();
  });
  it('rejects revoked return destinations before a provider rollback can begin', async () => {
    const f = fixture();
    await f.service().create(f.change(), actor, scopes);
    f.policy.assertReturnUrls.mockRejectedValueOnce(
      new ForbiddenException('origin revoked'),
    );
    await expect(
      f.service().cancel(f.input.idempotencyKey, f.input, actor),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.subscriptions.cancelPlanChange).not.toHaveBeenCalled();
  });
  it('refuses cancellation while a confirmation owns the attempt lease', async () => {
    const f = fixture();
    await f.service().create(f.change(), actor, scopes);
    f.rows.get(f.input.idempotencyKey)!.leaseUntil = new Date(
      Date.now() + 60_000,
    );
    await expect(
      f.service().cancel(f.input.idempotencyKey, f.input, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.subscriptions.cancelPlanChange).not.toHaveBeenCalled();
  });
});

describe('discard initial checkout attempts', () => {
  it('discards only the owned pending checkout and makes retries terminal', async () => {
    const f = fixture();
    await f.service().create(f.input, actor, scopes);
    expect(
      await f.service().cancel(f.input.idempotencyKey, f.input, actor),
    ).toEqual({ cancelled: true });
    expect(f.subscriptions.cancelPendingCheckout).toHaveBeenCalledWith(
      f.checkoutId,
      f.input,
      actor,
    );
    expect(f.subscriptions.cancelPlanChange).not.toHaveBeenCalled();
    expect(
      await f.service().cancel(f.input.idempotencyKey, f.input, actor),
    ).toEqual({ cancelled: true });
    expect(f.subscriptions.cancelPendingCheckout).toHaveBeenCalledTimes(1);
    expect(f.rows.get(f.input.idempotencyKey)).toMatchObject({
      status: 'rejected',
      receipt: { errorCode: 'PAYMENT_ATTEMPT_CANCELLED' },
    });
  });
  it('keeps an approved or ambiguous checkout recoverable when discard is refused', async () => {
    const f = fixture();
    await f.service().create(f.input, actor, scopes);
    f.subscriptions.cancelPendingCheckout.mockRejectedValueOnce(
      new ConflictException('refresh'),
    );
    await expect(
      f.service().cancel(f.input.idempotencyKey, f.input, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.rows.get(f.input.idempotencyKey)).toMatchObject({
      status: 'ready',
      leaseToken: null,
    });
  });
});

it('projects restoration approval for a scheduled cancellation while terminal noncancellations keep links suppressed', async () => {
  const f = fixture();
  await f.service().create(f.change(), actor, scopes);
  const response = f.rows.get(f.input.idempotencyKey)!;
  response.receipt.planChange = {
    state: 'scheduled',
    effectiveAt: '2030-02-01T00:00:00Z',
    cancellationRequested: true,
    action: 'approve_subscription',
    checkoutUrl: 'https://www.paypal.com/restore',
  };
  f.rows.set(response.id, response);
  f.checkout.getCheckoutStatus.mockRejectedValueOnce(
    new Error('status temporarily unavailable'),
  );
  expect(await f.service().get(response.id, f.input, actor)).toMatchObject({
    planChange: {
      cancellationRequested: true,
      action: 'approve_subscription',
      checkoutUrl: 'https://www.paypal.com/restore',
    },
    checkoutUrl: 'https://www.paypal.com/restore',
  });
  response.receipt.planChange.cancellationRequested = false;
  f.rows.set(response.id, response);
  f.checkout.getCheckoutStatus.mockRejectedValueOnce(new Error('offline'));
  expect(
    (await f.service().get(response.id, f.input, actor)).checkoutUrl,
  ).toBeUndefined();
});

describe('PayPal popup metadata on durable attempts', () => {
  it('reuses the prepared provider subscription and pinned configuration across retry/read without creating or verifying twice', async () => {
    const f = fixture(true);
    const receipt = await f.service().create(f.input, actor, scopes);
    expect(receipt.paypalApproval).toEqual({
      kind: 'subscription',
      subscriptionId: 'I-OWNED123',
      clientId: 'public-app',
      environment: 'sandbox',
    });
    expect(receipt.subscriptionId).toBe(f.subscriptionId);
    expect(receipt.checkoutUrl).toBe(f.popupCheckout.providerCheckoutUrl);
    f.checkout.getCheckoutStatus.mockResolvedValue({
      ...(await f.checkout.getCheckoutStatus()),
      checkoutStatus: BillingCheckoutSessionStatus.Created,
      subscriptionStatus: SubscriptionStatus.Pending,
    });
    f.checkout.getCheckoutStatus.mockClear();
    expect(
      (await f.service().retry(f.input.idempotencyKey, f.input, actor, scopes))
        .paypalApproval,
    ).toEqual(receipt.paypalApproval);
    expect(
      (await f.service().get(f.input.idempotencyKey, f.input, actor))
        .paypalApproval,
    ).toEqual(receipt.paypalApproval);
    expect(f.checkout.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(f.subscriptions.verifyCheckoutSession).not.toHaveBeenCalled();
    expect(f.paypalConnections.approvalConfiguration).toHaveBeenCalledTimes(1);
    expect(f.paypalConnections.approvalConfiguration).toHaveBeenCalledWith(
      null,
    );
    await expect(
      f
        .service()
        .get(
          f.input.idempotencyKey,
          { ...f.input, userId: randomUUID() },
          actor,
        ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('keeps the redirect fallback when optional configuration is unavailable', async () => {
    const f = fixture(true);
    f.paypalConnections.approvalConfiguration.mockRejectedValue(
      new Error('configuration unavailable'),
    );
    const receipt = await f.service().create(f.input, actor, scopes);
    expect(receipt.status).toBe('ready');
    expect(receipt.paypalApproval).toBeUndefined();
    expect(receipt.checkoutUrl).toBe(f.popupCheckout.providerCheckoutUrl);
  });

  it('omits stale popup metadata after activation and leaves legacy receipts usable', async () => {
    const f = fixture(true);
    await f.service().create(f.input, actor, scopes);
    const active = await f
      .service()
      .get(f.input.idempotencyKey, f.input, actor);
    expect(active.subscriptionStatus).toBe('active');
    expect(active.paypalApproval).toBeUndefined();
    delete f.rows.get(f.input.idempotencyKey)!.receipt.paypalApproval;
    expect(
      (await f.service().get(f.input.idempotencyKey, f.input, actor))
        .paypalApproval,
    ).toBeUndefined();
  });

  it('projects only approved popup fields and omits unsupported operations', async () => {
    const f = fixture(true);
    const receipt = await f.service().create(f.input, actor, scopes);
    const saved = f.rows.get(f.input.idempotencyKey)!;
    saved.receipt.paypalApproval = {
      ...receipt.paypalApproval,
      clientSecret: 'NEVER-FORWARD',
      accessToken: 'NEVER-FORWARD',
    } as never;
    f.checkout.getCheckoutStatus.mockResolvedValue({
      ...(await f.checkout.getCheckoutStatus()),
      checkoutStatus: BillingCheckoutSessionStatus.Created,
      subscriptionStatus: SubscriptionStatus.Pending,
    });
    expect(
      JSON.stringify(
        await f.service().get(f.input.idempotencyKey, f.input, actor),
      ),
    ).not.toContain('NEVER-FORWARD');
    f.rows.get(f.input.idempotencyKey)!.requestPayload.operation =
      'change_plan';
    const changed = await f
      .service()
      .get(f.input.idempotencyKey, f.input, actor);
    expect(changed.paypalApproval).toBeUndefined();
  });
});

describe('atomic checkout readiness notification', () => {
  it('queues the existing organization/product delivery after the ready receipt and does not signal or create again on replay', async () => {
    const f = fixture(true);
    const ready = await f.service().create(f.input, actor, scopes);
    expect(ready.status).toBe('ready');
    expect(f.committedSignals).toEqual([
      [f.input.organizationId, f.input.productCode],
    ]);
    expect(f.rows.get(f.input.idempotencyKey)?.receipt.paypalApproval).toEqual(
      ready.paypalApproval,
    );
    await f.service().retry(f.input.idempotencyKey, f.input, actor, scopes);
    await f.service().create(f.input, actor, scopes);
    expect(f.committedSignals).toHaveLength(1);
    expect(f.checkout.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(f.subscriptions.verifyCheckoutSession).not.toHaveBeenCalled();
  });

  it('rolls back the queued readiness with the receipt if the transaction fails before commit', async () => {
    const f = fixture(true);
    f.rejectNextReadyCommit();
    await expect(f.service().create(f.input, actor, scopes)).rejects.toThrow(
      'Commit rejected',
    );
    expect(
      f.domainQuery.mock.calls.some(([sql]) =>
        sql?.includes('queue_billing_license'),
      ),
    ).toBe(true);
    expect(f.committedSignals).toHaveLength(0);
    expect(f.rows.get(f.input.idempotencyKey)?.status).toBe('pending');
    expect(
      f.rows.get(f.input.idempotencyKey)?.receipt.paypalApproval,
    ).toBeUndefined();
    expect(f.checkout.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(f.subscriptions.verifyCheckoutSession).not.toHaveBeenCalled();
  });

  it('does not signal an uncertain attempt as ready', async () => {
    const f = fixture(true);
    f.checkout.createCheckoutSession.mockRejectedValue(
      new BadGatewayException('provider unavailable'),
    );
    expect((await f.service().create(f.input, actor, scopes)).status).toBe(
      'pending',
    );
    expect(f.committedSignals).toHaveLength(0);
  });
});
