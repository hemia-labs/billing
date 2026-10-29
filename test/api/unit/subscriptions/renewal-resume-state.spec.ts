import {
  BillingSubscriptionEntity,
  SubscriptionStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import {
  observeRenewalResume,
  renewalResumePending,
  acceptRenewalResumePayment,
} from '../../../../apps/api/src/modules/subscriptions-management/subscription-management-state';

test('future renewal isolates the replacement from the already paid source', () => {
  const source = Object.assign(new BillingSubscriptionEntity(), {
    id: 'paid-source',
    status: SubscriptionStatus.Cancelled,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: new Date('2030-02-01'),
    metadata: {},
  });
  const before = structuredClone(source);
  const candidate = Object.assign(new BillingSubscriptionEntity(), {
    id: 'replacement',
    status: SubscriptionStatus.Pending,
    metadata: {
      renewalResume: {
        sourceSubscriptionId: source.id,
        state: 'awaiting_approval',
        effectiveAt: '2030-02-01T00:00:00Z',
        amountDueNow: '0.00',
        recurringAmount: '999.00',
        currency: 'MXN',
      },
    },
  });
  expect(renewalResumePending(source)).toBe(false);
  expect(renewalResumePending(candidate)).toBe(true);
  expect(
    observeRenewalResume(candidate, {
      id: 'I-FUTURE',
      subscriptionStatus: SubscriptionStatus.Active,
    }),
  ).toBe(true);
  expect(candidate.status).toBe(SubscriptionStatus.Pending);
  expect(candidate.metadata.renewalResume).toMatchObject({
    state: 'scheduled',
  });
  expect(structuredClone(source)).toEqual(before);
});
test('failed replacement is terminal even when an older active snapshot arrives with paid evidence', () => {
  const candidate = Object.assign(new BillingSubscriptionEntity(), {
    id: 'replacement',
    status: SubscriptionStatus.Cancelled,
    metadata: {
      renewalResume: {
        sourceSubscriptionId: 'source',
        state: 'failed',
        effectiveAt: '2020-02-01T00:00:00Z',
        paidCaptureId: 'OLD',
      },
    },
  });
  const before = structuredClone(candidate);
  expect(
    observeRenewalResume(candidate, {
      id: 'I-FUTURE',
      subscriptionStatus: SubscriptionStatus.Active,
      lastPaymentAt: '2030-02-01T00:00:00Z',
    }),
  ).toBe(true);
  expect(structuredClone(candidate)).toEqual(before);
});
test.each([
  'valid',
  'early',
  'amount',
  'currency',
  'reversed',
  'missing-capture',
  'abandoned',
  'source',
])('future payment accepts only exact paid candidate evidence: %s', (mode) => {
  const marker = {
    sourceSubscriptionId: 'source',
    state: 'scheduled',
    effectiveAt: '2030-02-01T00:00:00Z',
    amountDueNow: '0.00',
    recurringAmount: '999.00',
    currency: 'MXN',
  };
  const candidate = Object.assign(new BillingSubscriptionEntity(), {
    id: mode === 'source' ? 'source' : 'candidate',
    metadata: {
      renewalResume: marker,
      ...(mode === 'abandoned' ? { checkoutAbandonment: {} } : {}),
    },
  });
  const payment = {
    status: mode === 'reversed' ? 'reversed' : 'paid',
    paidAt: new Date(mode === 'early' ? '2030-01-31' : '2030-02-01'),
    amount: mode === 'amount' ? '998.00' : '999.00',
    currency: mode === 'currency' ? 'USD' : 'MXN',
    providerCaptureId: mode === 'missing-capture' ? null : 'CAPTURE',
  };
  expect(
    acceptRenewalResumePayment(candidate, payment, new Date('2030-02-01')),
  ).toBe(mode === 'valid');
  if (mode === 'valid') {
    expect(
      acceptRenewalResumePayment(
        candidate,
        { ...payment, providerCaptureId: 'OTHER' },
        new Date('2030-02-01'),
      ),
    ).toBe(true);
    expect(candidate.metadata.renewalResume).toMatchObject({
      paidCaptureId: 'CAPTURE',
    });
  } else
    expect(candidate.metadata.renewalResume).not.toHaveProperty(
      'paidCaptureId',
    );
});
