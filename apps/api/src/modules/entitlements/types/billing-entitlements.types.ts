import type { BillingCurrency } from '../../billing-shared';

export type BillingEntitlementsSummary = {
  maxUsers: number;
  includedUsers: number;
  extraUsers: number;
  maxAgents: number;
  maxConversationsMonthly: number | null;
};

export type BillingAmountsSummary = {
  baseMonthly: string;
  addonsMonthly: string;
  totalMonthly: string;
  currency: BillingCurrency;
};

export type BillingEntitlementsResolution = {
  entitlements: BillingEntitlementsSummary;
  billing: BillingAmountsSummary;
};
