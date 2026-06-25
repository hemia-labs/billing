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
  checkoutId: string;
  subscriptionId: string;
  checkoutStatus: BillingCheckoutSessionStatus;
  subscriptionStatus: SubscriptionStatus;
  provider: BillingProvider;
}
