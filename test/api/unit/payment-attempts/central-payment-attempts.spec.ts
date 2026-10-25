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
function fixture() {
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
  const manager = {
    getRepository: (entity: unknown) =>
      entity === BillingSubscriptionEntity
        ? {
            findOne: () =>
              Promise.resolve({ provider: BillingProvider.Paypal }),
          }
        : repository,
    query: jest.fn(() => Promise.resolve([])),
  } as unknown as EntityManager;
  let queue: Promise<unknown> = Promise.resolve();
  const dataSource = {
    manager,
    getRepository: () => repository,
    transaction: <T>(work: (m: EntityManager) => Promise<T>) => {
      const result = queue.then(() => work(manager));
      queue = result.catch(() => undefined);
      return result;
    },
  } as unknown as DataSource;
  const checkout = {
    validateApprovalUrl: (_provider: BillingProvider, value: string) => value,
    resolveCheckoutProvider: jest.fn(() =>
      Promise.resolve(BillingProvider.Paypal),
    ),
    createCheckoutSession: jest.fn(() =>
      Promise.resolve({
        checkoutId,
        subscriptionId,
        checkoutUrl: 'https://www.paypal.com/approve',
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
    );
  const change = () => ({
    ...input,
    operation: 'change_plan' as const,
    expectedSubscriptionId: subscriptionId,
    expectedAmountDueNow: '150.00',
  });
  return {
    rows,
    input,
    checkoutId,
    subscriptionId,
    checkout,
    subscriptions,
    policy,
    service,
    change,
    repository,
  };
}

describe('central durable payment attempts', () => {
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
    );
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
