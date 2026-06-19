import { BillingInterval } from '../../billing-shared';
import type { BillingCurrency } from '../../billing-shared';
import { SubscriptionAddonStatus } from '../../billing-shared';

export class SubscriptionAddonResponseDto {
  id: string;
  subscriptionId: string;
  addonId: string;
  addonCode: string;
  quantity: number;
  status: SubscriptionAddonStatus;
  unitPrice: string;
  currency: BillingCurrency;
  billingInterval: BillingInterval;
  pendingEffectiveAt: Date | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SubscriptionAddonSummaryResponseDto {
  subscriptionId: string;
  planCode: string;
  baseAmount: string;
  addonsAmount: string;
  totalAmount: string;
  currency: BillingCurrency;
  addons: SubscriptionAddonResponseDto[];
}
