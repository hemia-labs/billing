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
  planChange?: {
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
