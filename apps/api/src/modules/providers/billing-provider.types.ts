import type { BillingProvider, SubscriptionStatus } from '../billing-shared';

export interface ProviderSubscriptionInput {
  providerPlanId: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
  quantity?: number;
  requestId?: string;
  subscriberEmail?: string;
  startTime?: string;
}
export interface ProviderSubscription {
  approvalPending?: boolean;
  id: string;
  status?: string;
  subscriptionStatus: SubscriptionStatus;
  planId?: string;
  approvalUrl?: string;
  nextBillingAt?: string;
  periodStart?: string;
  periodEnd?: string;
  lastPaymentAt?: string;
}
export interface ProviderOrder {
  id: string;
  status: 'pending' | 'approved' | 'completed' | 'cancelled';
  approvalUrl?: string;
  units: Array<{
    checkoutId?: string;
    amount?: string;
    currency?: string;
    captures: Array<{
      id?: string;
      status: 'pending' | 'completed' | 'failed' | 'refunded';
      amount?: string;
      currency?: string;
      paidAt?: string;
    }>;
  }>;
}
export interface BillingProviderAdapter {
  readonly provider: BillingProvider;
  validateApprovalUrl(value: string): string;
  readonly subscriptionIdempotencyWindowMs: number;
  readonly orderIdempotencyWindowMs: number;
  createSubscription(
    input: ProviderSubscriptionInput,
  ): Promise<ProviderSubscription>;
  getSubscription(id: string): Promise<ProviderSubscription>;
  validateFuturePlan?(
    id: string,
    expected: { amount: string; currency: string; interval: string },
  ): Promise<void>;
  getSubscriptionTransactions?(
    id: string,
    start: string,
    end: string,
  ): Promise<
    Array<{ id: string; amount: string; currency: string; paidAt: string }>
  >;
  reviseSubscription(input: {
    providerSubscriptionId: string;
    providerPlanId: string;
    requestId: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<ProviderSubscription>;
  cancelSubscription(input: {
    providerSubscriptionId: string;
    reason?: string;
  }): Promise<void>;
  createOrder(input: {
    requestId: string;
    checkoutId: string;
    amount: string;
    currency: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<ProviderOrder>;
  getOrder(id: string): Promise<ProviderOrder>;
  captureOrder(id: string, requestId: string): Promise<ProviderOrder>;
}
