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
  pendingRenewalPlanChange?: NonNullable<
    ReturnType<
      typeof import('../renewal-plan-change-state').renewalPlanChangeResponse
    >
  > & { attemptId: string; checkoutId: string };
  pendingRenewal?: NonNullable<
    ReturnType<
      typeof import('../subscription-management-state').renewalResumeResponse
    >
  > & {
    attemptId: string;
    subscriptionId: string;
    checkoutUrl?: string | null;
  };
  pendingCheckoutAttemptId?: string;
  planPriceCode: string | null;
  cancellation: {
    state: 'pending' | 'scheduled';
    requestedAt: string;
    effectiveAt: string | null;
  } | null;
  pendingPlanChange:
    | (Partial<
        ReturnType<
          typeof import('../subscription-management-state').planChangeResponse
        >
      > & {
        state:
          | 'preparing'
          | 'awaiting_approval'
          | 'scheduled'
          | 'effective'
          | 'failed';
        targetPlanCode: string;
        targetPlanPriceCode: string;
        effectiveAt: string;
        attemptId?: string;
        checkoutId: string | null;
        newSubscriptionId: string | null;
      })
    | null;
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
  planChange?: ReturnType<
    typeof import('../subscription-management-state').planChangeResponse
  >;
  effectiveAt: string;
  state: 'awaiting_approval' | 'scheduled' | 'effective';
  subscription: BillingSubscriptionManagementResponseDto;
  checkoutId: string;
  newSubscriptionId: string;
  checkoutUrl: string;
  targetPlanCode: string;
}

export interface VerifyCheckoutSessionResponseDto {
  renewalPlanChange?: ReturnType<
    typeof import('../renewal-plan-change-state').renewalPlanChangeResponse
  >;
  renewalResume?: ReturnType<
    typeof import('../subscription-management-state').renewalResumeResponse
  >;
  checkoutUrl?: string | null;
  planChange?: ReturnType<
    typeof import('../subscription-management-state').planChangeResponse
  >;
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
