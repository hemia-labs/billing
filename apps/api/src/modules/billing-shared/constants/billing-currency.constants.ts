export const DEFAULT_BILLING_CURRENCY = 'MXN';

export const BILLING_CURRENCIES = ['MXN', 'USD'] as const;

export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];
