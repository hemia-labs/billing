import {
  BillingCheckoutSessionStatus,
  BillingProvider,
  SubscriptionStatus,
} from '../../billing-shared';

export class CheckoutSessionResponseDto {
  checkoutId: string;
  subscriptionId: string;
  checkoutUrl: string;
  status: BillingCheckoutSessionStatus;
}

export class CheckoutSessionStatusResponseDto {
  renewalPlanChange?: ReturnType<
    typeof import('../../subscriptions-management/renewal-plan-change-state').renewalPlanChangeResponse
  >;
  renewalResume?: ReturnType<
    typeof import('../../subscriptions-management/subscription-management-state').renewalResumeResponse
  >;
  abandoned?: boolean;
  planChange?: Partial<
    ReturnType<
      typeof import('../../subscriptions-management/subscription-management-state').planChangeResponse
    >
  > & {
    state:
      'preparing' | 'awaiting_approval' | 'scheduled' | 'effective' | 'failed';
    effectiveAt: string;
  };
  checkoutId: string;
  subscriptionId: string;
  checkoutStatus: BillingCheckoutSessionStatus;
  subscriptionStatus: SubscriptionStatus;
  provider: BillingProvider;
}
