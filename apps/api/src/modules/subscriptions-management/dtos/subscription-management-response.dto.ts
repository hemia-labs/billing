import { BillingProvider, SubscriptionStatus } from '../../billing-shared';
import {
  BillingAmountsSummary,
  BillingEntitlementsSummary,
} from '../../entitlements';

export interface BillingSubscriptionPlanSummaryDto {
  id: string;
  code: string;
  amount: string;
  currency: string;
  billingInterval: string;
  seatsIncluded: number;
}

export interface BillingSubscriptionManagementResponseDto {
  id: string;
  organizationId: string;
  productCode: string;
  planCode: string;
  provider: BillingProvider;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  nextBillingTime: Date | null;
  cancelAtPeriodEnd: boolean;
  graceUntil: Date | null;
  plan: BillingSubscriptionPlanSummaryDto;
  entitlements: BillingEntitlementsSummary;
  billing: BillingAmountsSummary;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChangePlanResponseDto {
  subscription: BillingSubscriptionManagementResponseDto;
  checkoutId: string;
  newSubscriptionId: string;
  checkoutUrl: string;
  targetPlanCode: string;
}

export interface VerifyCheckoutSessionResponseDto {
  checkoutId: string;
  subscriptionId: string;
  provider: BillingProvider;
  providerSubscriptionId: string | null;
  providerStatus: string | null;
  checkoutStatus: string;
  subscriptionStatus: SubscriptionStatus;
  licenseStatus: string | null;
  verifiedAt: Date;
}
