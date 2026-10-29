export type PaypalEnvironment = 'sandbox' | 'live';

export interface CreatePaypalSubscriptionInput {
  providerPlanId: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
  quantity?: number;
  requestId?: string;
  subscriberEmail?: string;
  startTime?: string;
}

export interface PaypalSubscriptionResult {
  id: string;
  status?: string;
  approvalUrl?: string;
  raw: Record<string, unknown>;
}

export interface PaypalSubscriptionDetails {
  id: string;
  status?: string;
  planId?: string;
  billingInfo?: Record<string, unknown>;
  subscriber?: Record<string, unknown>;
  approvalUrl?: string;
  raw: Record<string, unknown>;
}

export interface RevisePaypalSubscriptionInput {
  providerSubscriptionId: string;
  providerPlanId: string;
  requestId: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface CancelPaypalSubscriptionInput {
  providerSubscriptionId: string;
  reason?: string;
}

export interface VerifyPaypalWebhookInput {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
  webhookEvent: Record<string, unknown>;
}

export interface PaypalWebhookVerificationResult {
  verified: boolean;
  verificationStatus?: string;
  raw: Record<string, unknown>;
}

export interface PaypalApiErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: unknown[];
}

export class PaypalApiException extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
    readonly debugId?: string,
    readonly body?: PaypalApiErrorBody | Record<string, unknown>,
  ) {
    super(message);
  }
}
