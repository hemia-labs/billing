import type { BillingCurrency } from '../../billing-shared';

export type BillingEntitlementsSummary = {
  maxUsers: number;
  includedUsers: number;
  extraUsers: number;
  maxAgents: number;
  maxConversationsMonthly: number | null;
  additional: Record<string, number>;
  featureFlags: Record<string, boolean>;
};

export type BillingAmountsSummary = {
  baseMonthly: string;
  addonsMonthly: string;
  totalMonthly: string;
  currency: BillingCurrency;
  nextBillingTime?: string | null;
};

export type BillingEntitlementsResolution = {
  entitlements: BillingEntitlementsSummary;
  billing: BillingAmountsSummary;
};
