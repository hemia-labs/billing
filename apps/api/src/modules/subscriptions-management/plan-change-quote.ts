import { BadRequestException } from '@nestjs/common';
import {
  BillingPlanPriceEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';

export interface PlanChangeQuote {
  kind: 'upgrade' | 'downgrade';
  amountDueNow: string;
  currency: string;
  effectiveAt: string;
  nextBillingAt: string;
  recurringAmount: string;
}
export function cents(value: string): bigint {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value))
    throw new BadRequestException('Invalid monetary amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function money(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
export function calculatePlanChangeQuote(
  subscription: BillingSubscriptionEntity,
  current: BillingPlanPriceEntity,
  target: BillingPlanPriceEntity,
  now = new Date(),
): PlanChangeQuote {
  if (current.currency !== target.currency)
    throw new BadRequestException('Target plan currency must match');
  if (
    current.billingInterval !== target.billingInterval ||
    current.billingIntervalCount !== target.billingIntervalCount
  )
    throw new BadRequestException(
      'Changing billing intervals is not supported',
    );
  const end = subscription.currentPeriodEnd ?? subscription.nextBillingTime;
  const start = subscription.currentPeriodStart;
  if (!end || end.getTime() <= now.getTime())
    throw new BadRequestException(
      'A confirmed future billing boundary is required',
    );
  const difference = cents(target.amount) - cents(current.amount);
  if (difference === 0n)
    throw new BadRequestException('Target plan must have a different price');
  let due = 0n;
  if (difference > 0n) {
    if (
      !start ||
      start.getTime() > now.getTime() ||
      start.getTime() >= end.getTime()
    )
      throw new BadRequestException(
        'A confirmed paid billing period is required',
      );
    const duration = BigInt(end.getTime() - start.getTime());
    due =
      (difference * BigInt(end.getTime() - now.getTime()) + duration / 2n) /
      duration;
  }
  return {
    kind: difference > 0n ? 'upgrade' : 'downgrade',
    amountDueNow: money(due),
    currency: target.currency,
    recurringAmount: money(cents(target.amount)),
    effectiveAt: difference > 0n ? now.toISOString() : end.toISOString(),
    nextBillingAt: end.toISOString(),
  };
}
