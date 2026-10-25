import {
  BillingPlanPriceEntity,
  BillingSubscriptionEntity,
  PlanPriceBillingInterval,
} from '../../../../apps/api/src/modules/billing-shared';
import {
  calculatePlanChangeQuote,
  cents,
} from '../../../../apps/api/src/modules/subscriptions-management/plan-change-quote';
const current = {
  amount: '300.00',
  currency: 'MXN',
  billingInterval: PlanPriceBillingInterval.Month,
  billingIntervalCount: 1,
} as BillingPlanPriceEntity;
const target = { ...current, amount: '600.00' };
const subscription = {
  currentPeriodStart: new Date('2030-04-01'),
  currentPeriodEnd: new Date('2030-05-01'),
} as BillingSubscriptionEntity;
const now = new Date('2030-04-16');
describe('exact proration quote', () => {
  it('charges the difference for the remaining paid fraction', () => {
    expect(
      calculatePlanChangeQuote(subscription, current, target, now),
    ).toMatchObject({
      kind: 'upgrade',
      amountDueNow: '150.00',
      recurringAmount: '600.00',
      effectiveAt: now.toISOString(),
      nextBillingAt: '2030-05-01T00:00:00.000Z',
    });
  });
  it.each([
    ['2030-01-01', '2030-02-01', '2030-01-01', '500.00'],
    ['2030-01-01', '2030-02-01', '2030-01-10', '354.84'],
    ['2030-01-01', '2030-02-01', '2030-01-24', '129.03'],
    ['2032-02-01', '2032-03-01', '2032-02-15T12:00:00Z', '250.00'],
    ['2030-01-01', '2030-02-01', '2030-01-31T23:59:59.999Z', '0.00'],
  ])('uses the actual paid period %s–%s at %s', (start, end, at, expected) => {
    expect(
      calculatePlanChangeQuote(
        {
          currentPeriodStart: new Date(start),
          currentPeriodEnd: new Date(end),
        } as BillingSubscriptionEntity,
        { ...current, amount: '499.00' },
        { ...target, amount: '999.00' },
        new Date(at),
      ).amountDueNow,
    ).toBe(expected);
  });
  it('requires a future boundary and rejects equal prices and different interval counts', () => {
    expect(() =>
      calculatePlanChangeQuote(
        subscription,
        current,
        target,
        subscription.currentPeriodEnd!,
      ),
    ).toThrow('future billing boundary');
    expect(() =>
      calculatePlanChangeQuote(subscription, current, current, now),
    ).toThrow('different price');
    expect(() =>
      calculatePlanChangeQuote(
        subscription,
        current,
        { ...target, billingIntervalCount: 2 },
        now,
      ),
    ).toThrow('interval');
  });
  it('defers lower plans without a refund or charge', () => {
    expect(
      calculatePlanChangeQuote(subscription, target, current, now),
    ).toMatchObject({
      kind: 'downgrade',
      amountDueNow: '0.00',
      effectiveAt: '2030-05-01T00:00:00.000Z',
    });
  });
  it('rounds half cents up using integer arithmetic', () => {
    expect(
      calculatePlanChangeQuote(
        subscription,
        current,
        { ...target, amount: '300.01' },
        now,
      ).amountDueNow,
    ).toBe('0.01');
  });
  it('rejects unsupported currencies, intervals, unpaid periods and malformed money', () => {
    expect(() =>
      calculatePlanChangeQuote(
        subscription,
        current,
        { ...target, currency: 'USD' },
        now,
      ),
    ).toThrow('currency');
    expect(() =>
      calculatePlanChangeQuote(
        subscription,
        current,
        { ...target, billingInterval: PlanPriceBillingInterval.Year },
        now,
      ),
    ).toThrow('interval');
    expect(() =>
      calculatePlanChangeQuote(
        { ...subscription, currentPeriodStart: null },
        current,
        target,
        now,
      ),
    ).toThrow('paid billing period');
    expect(() => cents('1.001')).toThrow();
    expect(() => cents('-1')).toThrow();
  });
});
