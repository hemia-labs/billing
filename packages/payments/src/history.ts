import { PaymentsError } from './errors';

export type PaymentHistoryItem = {
  id: string;
  subscriptionId: string;
  organizationId: string;
  productCode: string;
  provider: 'paypal';
  amount: string;
  currency: string;
  status: 'paid' | 'partially_refunded' | 'refunded' | 'reversed';
  paidAt: string | null;
  createdAt: string;
  reference: string | null;
  description?: string;
  refundedAmount?: string;
};
export type PaymentHistoryPage = { items: PaymentHistoryItem[]; nextCursor: string | null };
export type PaymentHistoryOptions = { cursor?: string };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const cursor = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048 && /^[A-Za-z0-9_-]+$/.test(value);
const iso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const cents = (value: unknown): bigint | null => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};

export function paymentHistoryQuery(organizationId: string, productCode: string, options: PaymentHistoryOptions): URLSearchParams {
  if (!uuid(organizationId) || !record(options) || Object.keys(options).some(key => key !== 'cursor')
    || (options.cursor !== undefined && !cursor(options.cursor))) throw new PaymentsError('configuration', 400);
  return new URLSearchParams({ organization_id: organizationId.toLowerCase(), product_code: productCode,
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }) });
}

export function parsePaymentHistory(value: unknown, organizationId: string, productCode: string): PaymentHistoryPage {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > 25
    || (value.nextCursor !== null && !cursor(value.nextCursor))
    || (value.nextCursor !== null && value.items.length !== 25)) throw new PaymentsError('contract');
  const ids = new Set<string>();
  const items = value.items.map((item: unknown): PaymentHistoryItem => {
    if (!record(item) || !uuid(item.id) || ids.has(item.id.toLowerCase()) || !uuid(item.subscriptionId)
      || item.organizationId !== organizationId || item.productCode !== productCode || item.provider !== 'paypal'
      || !['paid', 'partially_refunded', 'refunded', 'reversed'].includes(String(item.status))
      || !(item.paidAt === null || iso(item.paidAt)) || !iso(item.createdAt)
      || typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)
      || !(item.reference === null || (typeof item.reference === 'string' && item.reference.length > 0 && item.reference.length <= 180))
      || (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 240))) throw new PaymentsError('contract');
    const amount = cents(item.amount), refund = item.refundedAmount === undefined ? null : cents(item.refundedAmount);
    if (amount === null || (item.refundedAmount !== undefined && (refund === null || refund <= 0n || refund > amount))
      || (item.status === 'partially_refunded' && (refund === null || refund <= 0n || refund >= amount))
      || (item.status === 'paid' && refund !== null)) throw new PaymentsError('contract');
    ids.add(item.id.toLowerCase());
    return {
      id: item.id, subscriptionId: item.subscriptionId, organizationId, productCode, provider: 'paypal',
      amount: item.amount as string, currency: item.currency, status: item.status as PaymentHistoryItem['status'],
      paidAt: item.paidAt, createdAt: item.createdAt, reference: item.reference,
      ...(item.description === undefined ? {} : { description: item.description as string }),
      ...(item.refundedAmount === undefined ? {} : { refundedAmount: item.refundedAmount as string }),
    };
  });
  return { items, nextCursor: value.nextCursor as string | null };
}
