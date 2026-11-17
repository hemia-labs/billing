import { BillingSnapshotsService } from '../../../../apps/api/src/modules/licenses/billing-snapshots.service';
import {
  BillingCheckoutSessionEntity,
  BillingCheckoutSessionStatus,
  BillingPaymentEntity,
  BillingPaymentRefundEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProvider,
  BillingSubscriptionEntity,
  BillingWebhookEventEntity,
  LicenseStatus,
  PaymentStatus,
  PlanPriceBillingInterval,
  SubscriptionStatus,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '../../../../apps/api/src/modules/billing-shared';

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

function paidCheckoutFixture() {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const subscription = Object.assign(new BillingSubscriptionEntity(), {
    id: '22222222-2222-4222-8222-222222222222',
    organizationId,
    productCode: 'medsync',
    provider: BillingProvider.Paypal,
    providerSubscriptionId: 'I-ORIGINAL',
    status: SubscriptionStatus.Active,
    planId: '33333333-3333-4333-8333-333333333333',
    planCode: 'medsync_pro',
    planPriceId: '44444444-4444-4444-8444-444444444444',
    providerPriceId: '55555555-5555-4555-8555-555555555555',
    planPriceCode: 'pro_monthly_mxn',
    currentPeriodEnd: new Date('2026-11-01T12:00:00Z'),
    nextBillingTime: new Date('2026-11-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    metadata: {},
  });
  const price = Object.assign(new BillingPlanPriceEntity(), {
    id: subscription.planPriceId,
    code: subscription.planPriceCode,
    amount: '499.00',
    currency: 'MXN' as const,
    billingInterval: PlanPriceBillingInterval.Month,
    billingIntervalCount: 1,
    planVersion: Object.assign(new BillingPlanVersionEntity(), {
      planId: subscription.planId,
    }),
  });
  const checkout = Object.assign(new BillingCheckoutSessionEntity(), {
    id: '66666666-6666-4666-8666-666666666666',
    organizationId,
    userId: '77777777-7777-4777-8777-777777777777',
    productCode: 'medsync',
    planId: subscription.planId,
    planPriceId: price.id,
    providerPriceId: subscription.providerPriceId,
    planPriceCode: price.code,
    planPrice: price,
    provider: BillingProvider.Paypal,
    status: BillingCheckoutSessionStatus.Created,
    createdAt: new Date('2026-10-01T11:59:00Z'),
    metadata: { subscriptionId: subscription.id },
  });
  const payment = Object.assign(new BillingPaymentEntity(), {
    id: '88888888-8888-4888-8888-888888888888',
    organizationId,
    subscriptionId: subscription.id,
    provider: BillingProvider.Paypal,
    providerCaptureId: 'SALE-INITIAL',
    amount: '499.00',
    currency: 'MXN' as const,
    status: PaymentStatus.Paid,
    paidAt: new Date('2026-10-01T12:00:00Z'),
    createdAt: new Date('2026-10-01T12:00:01Z'),
    rawEventId: '99999999-9999-4999-8999-999999999999',
    metadata: {},
  });
  payment.metadata.initialCheckoutPayment = {
    providerSubscriptionId: subscription.providerSubscriptionId,
    paidAt: payment.paidAt.toISOString(),
    regularCyclesCompleted: 1,
  };
  const resource: Record<string, unknown> = {
    id: payment.providerCaptureId,
    billing_agreement_id: subscription.providerSubscriptionId,
    state: 'completed',
    create_time: payment.paidAt.toISOString(),
  };
  const event = Object.assign(new BillingWebhookEventEntity(), {
    id: payment.rawEventId,
    provider: BillingProvider.Paypal,
    providerConnectionId: null,
    resourceId: payment.providerCaptureId,
    eventType: 'PAYMENT.SALE.COMPLETED',
    verificationStatus: WebhookVerificationStatus.Verified,
    processingStatus: WebhookProcessingStatus.Processed,
    requiresManualReview: false,
    payloadJson: { resource },
  });
  const f = fixture([subscription]);
  f.licenses.resolveLicense.mockResolvedValue({
    active: true,
    licenseStatus: LicenseStatus.Active,
    productCode: 'medsync',
    subscriptionId: subscription.id,
    planCode: subscription.planCode,
    billing: {
      baseMonthly: '499.00',
      addonsMonthly: '100.00',
      totalMonthly: '599.00',
      currency: 'MXN',
    },
  } as never);
  const checkouts = {
    findOne: jest.fn(() =>
      Promise.resolve(checkout as BillingCheckoutSessionEntity | null),
    ),
  };
  const payments = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(() =>
      Promise.resolve(payment as BillingPaymentEntity | null),
    ),
  };
  const events = {
    findOneBy: jest.fn(() =>
      Promise.resolve(event as BillingWebhookEventEntity | null),
    ),
  };
  const refunds = { existsBy: jest.fn(() => Promise.resolve(false)) };
  f.runner.manager.getRepository.mockImplementation((entity?: unknown) => {
    if (entity === BillingCheckoutSessionEntity) return checkouts as never;
    if (entity === BillingPaymentEntity)
      return { createQueryBuilder: () => payments } as never;
    if (entity === BillingWebhookEventEntity) return events as never;
    if (entity === BillingPaymentRefundEntity) return refunds as never;
    if (entity !== BillingSubscriptionEntity)
      throw new Error('Unexpected catalog lookup');
    return { find: () => Promise.resolve([subscription]) } as never;
  });
  return {
    ...f,
    subscription,
    price,
    checkout,
    payment,
    event,
    resource,
    checkouts,
    payments,
    events,
    refunds,
    snapshot: () => f.service.current(organizationId, 'medsync'),
  };
}

function confirmation(
  result: Awaited<ReturnType<BillingSnapshotsService['current']>>,
) {
  return (
    result.license.billing as unknown as Record<string, unknown> | undefined
  )?.checkoutConfirmation;
}

describe('optional paid checkout confirmation', () => {
  it('adds only allowlisted initial sale facts without exposing provider credentials or mutable plan names', async () => {
    const f = paidCheckoutFixture();
    f.subscription.metadata.clientSecret = 'must-not-leak';
    f.checkout.metadata.checkoutUrl = 'https://private.example/approval';
    const result = await f.snapshot();
    expect(confirmation(result)).toEqual({
      status: 'completed',
      organizationId: f.subscription.organizationId,
      productCode: 'medsync',
      subscriptionId: f.subscription.id,
      paymentId: f.payment.id,
      userId: f.checkout.userId,
      planCode: 'medsync_pro',
      planPriceCode: 'pro_monthly_mxn',
      planName: null,
      recurringAmount: '499.00',
      currency: 'MXN',
      billingInterval: 'month',
      billingIntervalCount: 1,
      paidAmount: '499.00',
      paidAt: '2026-10-01T12:00:00.000Z',
      provider: 'paypal',
      nextBillingAt: '2026-11-01T12:00:00.000Z',
    });
    expect(result.license.billing).toMatchObject({
      addonsMonthly: '100.00',
      totalMonthly: '599.00',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /must-not-leak|private.example|I-ORIGINAL|SALE-INITIAL/,
    );
    expect(f.checkouts.findOne.mock.calls[0][0]).toMatchObject({
      where: {
        organizationId: f.subscription.organizationId,
        productCode: 'medsync',
      },
      relations: { planPrice: { planVersion: true } },
    });
    expect(f.refunds.existsBy).toHaveBeenCalledWith({
      paymentId: f.payment.id,
    });
  });

  it('does not turn an active subscription or checkout approval into a paid confirmation', async () => {
    const f = paidCheckoutFixture();
    f.checkout.status = BillingCheckoutSessionStatus.Approved;
    f.payments.getOne.mockResolvedValue(null);
    const result = await f.snapshot();
    expect(result.license.active).toBe(true);
    expect(confirmation(result)).toBeUndefined();
  });

  it.each([
    PaymentStatus.Pending,
    PaymentStatus.Failed,
    PaymentStatus.Refunded,
    PaymentStatus.Reversed,
  ])(
    'never skips an initial %s payment to use a later completed renewal',
    async (status) => {
      const f = paidCheckoutFixture();
      f.payment.status = status;
      expect(confirmation(await f.snapshot())).toBeUndefined();
      expect(f.payments.where).toHaveBeenCalledTimes(1);
      expect(f.payments.where).toHaveBeenCalledWith(
        'payment.subscriptionId = :subscriptionId',
        { subscriptionId: f.subscription.id },
      );
      expect(f.payments.orderBy).toHaveBeenCalledWith(
        'COALESCE(payment.paidAt, payment.createdAt)',
        'ASC',
      );
      expect(f.payments.addOrderBy).toHaveBeenLastCalledWith(
        'payment.id',
        'ASC',
      );
    },
  );

  it('omits partially refunded sales even while their payment status remains paid', async () => {
    const f = paidCheckoutFixture();
    f.refunds.existsBy.mockResolvedValue(true);
    expect(confirmation(await f.snapshot())).toBeUndefined();
  });

  it('omits a first locally observed renewal without durable first-cycle evidence', async () => {
    const f = paidCheckoutFixture();
    delete f.payment.metadata.initialCheckoutPayment;
    expect(confirmation(await f.snapshot())).toBeUndefined();
    expect(f.events.findOneBy).not.toHaveBeenCalled();
  });

  it('retains the initial payment and frozen recurring price across ordinary monthly confirmations', async () => {
    const f = paidCheckoutFixture();
    const first = confirmation(await f.snapshot());
    f.subscription.currentPeriodStart = new Date('2026-10-22T12:00:00Z');
    f.subscription.currentPeriodEnd = new Date('2026-11-22T12:00:00Z');
    f.subscription.nextBillingTime = new Date('2026-11-22T12:00:00Z');
    expect(confirmation(await f.snapshot())).toEqual({
      ...(first as object),
      nextBillingAt: '2026-11-22T12:00:00.000Z',
    });
  });

  it.each(['checkout', 'payment'] as const)(
    'rejects a %s from another tenant or product',
    async (source) => {
      const f = paidCheckoutFixture();
      f[source].organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      expect(confirmation(await f.snapshot())).toBeUndefined();
      expect((await f.snapshot()).license.active).toBe(true);
    },
  );

  it.each(['operation', 'renewalResume'] as const)(
    'omits a checkout marked %s',
    async (marker) => {
      const f = paidCheckoutFixture();
      f.checkout.metadata[marker] =
        marker === 'operation' ? 'plan_change' : { state: 'scheduled' };
      expect(confirmation(await f.snapshot())).toBeUndefined();
    },
  );

  it.each(['renewalResume', 'checkoutAbandonment', 'refundRevocation'])(
    'omits a contract marked %s',
    async (marker) => {
      const f = paidCheckoutFixture();
      f.subscription.metadata[marker] = { state: 'scheduled' };
      expect(confirmation(await f.snapshot())).toBeUndefined();
      expect(f.checkouts.findOne).not.toHaveBeenCalled();
    },
  );

  it.each([
    'operation',
    'subscriptionAddonId',
    'renewalResumeReview',
    'refundReview',
  ])('omits a payment marked %s', async (marker) => {
    const f = paidCheckoutFixture();
    f.payment.metadata[marker] =
      marker === 'operation' ? 'plan_change_proration' : 'not-a-base-checkout';
    expect(confirmation(await f.snapshot())).toBeUndefined();
  });

  it('rejects an addon sale event despite an incorrectly associated local payment', async () => {
    const f = paidCheckoutFixture();
    f.resource.billing_agreement_id = 'I-ADDON';
    expect(confirmation(await f.snapshot())).toBeUndefined();
  });

  it('omits confirmation when the active license belongs to a different plan', async () => {
    const f = paidCheckoutFixture();
    f.licenses.resolveLicense.mockResolvedValueOnce({
      active: true,
      licenseStatus: LicenseStatus.Active,
      productCode: 'medsync',
      subscriptionId: f.subscription.id,
      planCode: 'other-plan',
    } as never);
    expect(confirmation(await f.snapshot())).toBeUndefined();
    expect(f.checkouts.findOne).not.toHaveBeenCalled();
  });

  it('rejects a checkout from another product while preserving active access', async () => {
    const f = paidCheckoutFixture();
    f.checkout.productCode = 'another-product';
    const result = await f.snapshot();
    expect(confirmation(result)).toBeUndefined();
    expect(result.license.active).toBe(true);
  });

  it('does not use a different current plan or price instead of the checkout contract', async () => {
    const f = paidCheckoutFixture();
    f.subscription.planPriceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(confirmation(await f.snapshot())).toBeUndefined();
  });

  it('rejects same-provider events or payments from a different PayPal app', async () => {
    const f = paidCheckoutFixture();
    f.event.providerConnectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(confirmation(await f.snapshot())).toBeUndefined();
    f.event.providerConnectionId = null;
    f.payment.metadata.providerConnectionId =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(confirmation(await f.snapshot())).toBeUndefined();
  });

  it('allows consistently pinned app credentials without exposing their connection ID', async () => {
    const f = paidCheckoutFixture();
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    for (const row of [f.subscription, f.checkout, f.payment])
      row.metadata.providerConnectionId = id;
    f.event.providerConnectionId = id;
    const result = await f.snapshot();
    expect(confirmation(result)).toMatchObject({ status: 'completed' });
    expect(JSON.stringify(result)).not.toContain(id);
  });

  it.each(['grace', 'inactive', 'past_due'])(
    'never adds a paid welcome fact for %s access',
    async (state) => {
      const f = paidCheckoutFixture();
      if (state === 'past_due')
        f.subscription.status = SubscriptionStatus.PastDue;
      else
        f.licenses.resolveLicense.mockResolvedValueOnce({
          active: state !== 'inactive',
          licenseStatus:
            state === 'grace' ? LicenseStatus.Grace : LicenseStatus.Revoked,
          productCode: 'medsync',
          subscriptionId: f.subscription.id,
        } as never);
      expect(confirmation(await f.snapshot())).toBeUndefined();
      expect(f.checkouts.findOne).not.toHaveBeenCalled();
    },
  );

  it.each([
    'no_event',
    'activation_event',
    'unverified',
    'unprocessed',
    'wrong_sale',
    'missing_sale_time',
    'future_payment',
    'missing_price',
  ])('omits unreliable facts: %s', async (invalid) => {
    const f = paidCheckoutFixture();
    if (invalid === 'no_event') f.events.findOneBy.mockResolvedValue(null);
    if (invalid === 'activation_event')
      f.event.eventType = 'BILLING.SUBSCRIPTION.ACTIVATED';
    if (invalid === 'unverified')
      f.event.verificationStatus = 'invalid' as never;
    if (invalid === 'unprocessed')
      f.event.processingStatus = WebhookProcessingStatus.Pending;
    if (invalid === 'wrong_sale') f.resource.id = 'OTHER-SALE';
    if (invalid === 'missing_sale_time') delete f.resource.create_time;
    if (invalid === 'future_payment') f.payment.paidAt = new Date('2030-01-01');
    if (invalid === 'missing_price') f.checkout.planPrice = null;
    expect(confirmation(await f.snapshot())).toBeUndefined();
  });
});
