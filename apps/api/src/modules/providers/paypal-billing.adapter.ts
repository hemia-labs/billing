import { ConflictException } from '@nestjs/common';
import { PaypalApiException } from '../paypal/types/paypal.types';
import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingProvider, SubscriptionStatus } from '../billing-shared';
import { PaypalClientService } from '../paypal';
import type { PaypalSubscriptionDetails } from '../paypal/types';
import type {
  BillingProviderAdapter,
  ProviderOrder,
  ProviderSubscription,
  ProviderSubscriptionInput,
} from './billing-provider.types';

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
function moneyCents(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value))
    return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function paypalApprovalUrl(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ['www.paypal.com', 'www.sandbox.paypal.com'].includes(url.hostname)
    )
      return url.href;
  } catch {
    /* Fail closed on untrusted provider links. */
  }
  throw new BadGatewayException('Invalid provider approval URL');
}
export function paypalSubscription(
  value: PaypalSubscriptionDetails,
): ProviderSubscription {
  const billing = value.billingInfo ?? record(value.raw?.billing_info);
  const cycles = Array.isArray(billing.cycle_executions)
    ? record(billing.cycle_executions[0])
    : {};
  const statuses: Record<string, SubscriptionStatus> = {
    ACTIVE: SubscriptionStatus.Active,
    SUSPENDED: SubscriptionStatus.Suspended,
    CANCELLED: SubscriptionStatus.Cancelled,
    EXPIRED: SubscriptionStatus.Expired,
  };
  return {
    id: value.id,
    approvalPending: value.status === 'APPROVAL_PENDING',
    status: value.status,
    subscriptionStatus:
      statuses[value.status ?? ''] ?? SubscriptionStatus.Pending,
    planId: value.planId,
    approvalUrl: paypalApprovalUrl(value.approvalUrl),
    nextBillingAt: text(billing.next_billing_time),
    periodStart: text(cycles.start_time),
    periodEnd: text(cycles.end_time),
    lastPaymentAt: text(record(billing.last_payment).time),
  };
}
function order(value: Record<string, unknown>): ProviderOrder {
  const links = Array.isArray(value.links) ? value.links.map(record) : [];
  const approval = links.find((link) =>
    ['payer-action', 'approve'].includes(String(link.rel)),
  );
  const units: ProviderOrder['units'] = (
    Array.isArray(value.purchase_units) ? value.purchase_units : []
  ).map((value) => {
    const unit = record(value),
      amount = record(unit.amount),
      payments = record(unit.payments);
    const captures: ProviderOrder['units'][number]['captures'] = (
      Array.isArray(payments.captures) ? payments.captures : []
    ).map((value) => {
      const capture = record(value),
        amount = record(capture.amount);
      return {
        id: text(capture.id),
        status:
          capture.status === 'COMPLETED'
            ? 'completed'
            : capture.status === 'REFUNDED'
              ? 'refunded'
              : capture.status === 'FAILED' || capture.status === 'DECLINED'
                ? 'failed'
                : 'pending',
        amount: text(amount.value),
        currency: text(amount.currency_code),
        paidAt: text(capture.create_time),
      };
    });
    return {
      checkoutId: text(unit.custom_id),
      amount: text(amount.value),
      currency: text(amount.currency_code),
      captures,
    };
  });
  return {
    id: text(value.id) ?? '',
    status:
      value.status === 'COMPLETED'
        ? 'completed'
        : value.status === 'APPROVED'
          ? 'approved'
          : value.status === 'VOIDED'
            ? 'cancelled'
            : 'pending',
    approvalUrl: paypalApprovalUrl(text(approval?.href)),
    units,
  };
}
@Injectable()
export class PaypalBillingAdapter implements BillingProviderAdapter {
  readonly provider = BillingProvider.Paypal;
  readonly subscriptionIdempotencyWindowMs = 72 * 60 * 60 * 1000;
  readonly orderIdempotencyWindowMs = 6 * 60 * 60 * 1000;
  constructor(private readonly client: PaypalClientService) {}
  validateApprovalUrl(value: string) {
    return paypalApprovalUrl(value)!;
  }
  async validateFuturePlan(
    id: string,
    expected: { amount: string; currency: string; interval: string },
  ): Promise<void> {
    const plan = await this.client.getPlan(id);
    const cycles = plan.billing_cycles as
      | Array<{
          tenure_type?: string;
          frequency?: { interval_unit?: string; interval_count?: number };
          pricing_scheme?: {
            fixed_price?: { value?: string; currency_code?: string };
          };
        }>
      | undefined;
    const preferences = plan.payment_preferences as
      { setup_fee?: { value?: string } } | undefined;
    const cycle = cycles?.[0];
    const expectedInterval = expected.interval.toUpperCase().replace(/LY$/, '');
    const base = moneyCents(cycle?.pricing_scheme?.fixed_price?.value);
    const taxes = plan.taxes as
      { percentage?: string; inclusive?: boolean } | undefined;
    const percent = moneyCents(taxes?.percentage ?? '0');
    const gross =
      base !== null && percent !== null
        ? taxes?.inclusive === true
          ? base
          : (base * (10000n + percent) + 5000n) / 10000n
        : null;
    if (
      plan.status !== 'ACTIVE' ||
      !cycles ||
      cycles.length !== 1 ||
      cycle?.tenure_type !== 'REGULAR' ||
      cycle.frequency?.interval_count !== 1 ||
      cycle.frequency.interval_unit !== expectedInterval ||
      gross === null ||
      gross !== moneyCents(expected.amount) ||
      cycle.pricing_scheme?.fixed_price?.currency_code !== expected.currency ||
      moneyCents(preferences?.setup_fee?.value ?? '0') !== 0n ||
      plan.quantity_supported === true
    )
      throw new ConflictException(
        'Provider plan is not an exact future renewal without signup charges',
      );
  }
  async getSubscriptionTransactions(id: string, start: string, end: string) {
    const response = await this.client.getSubscriptionTransactions(
      id,
      start,
      end,
    );
    const rows = response.transactions as
      | Array<{
          id: string;
          status: string;
          time: string;
          amount_with_breakdown?: {
            gross_amount?: { value?: string; currency_code?: string };
          };
        }>
      | undefined;
    return (rows ?? [])
      .filter((row) => row.status === 'COMPLETED')
      .map((row) => ({
        id: row.id,
        paidAt: row.time,
        amount: row.amount_with_breakdown?.gross_amount?.value ?? '',
        currency: row.amount_with_breakdown?.gross_amount?.currency_code ?? '',
      }));
  }
  async createSubscription(input: ProviderSubscriptionInput) {
    return paypalSubscription(await this.client.createSubscription(input));
  }
  async getSubscription(id: string) {
    return paypalSubscription(await this.client.getSubscription(id));
  }
  async reviseSubscription(
    input: Parameters<BillingProviderAdapter['reviseSubscription']>[0],
  ) {
    return paypalSubscription(await this.client.reviseSubscription(input));
  }
  cancelSubscription(
    input: Parameters<BillingProviderAdapter['cancelSubscription']>[0],
  ) {
    return this.client.cancelSubscription(input);
  }
  async createOrder(
    input: Parameters<BillingProviderAdapter['createOrder']>[0],
  ) {
    return order(await this.client.createOrder(input));
  }
  async getOrder(id: string) {
    try {
      return order(await this.client.getOrder(id));
    } catch (error) {
      if (error instanceof PaypalApiException && error.status === 404)
        throw new NotFoundException('Provider order not found');
      throw error;
    }
  }
  async captureOrder(id: string, requestId: string) {
    return order(await this.client.captureOrder(id, requestId));
  }
}
