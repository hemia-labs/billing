import type { WebhookProcessingStatus } from '../../billing-shared';

export interface PaypalWebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

export interface BillingWebhookProcessResult {
  eventId: string;
  providerEventId: string;
  processingStatus: WebhookProcessingStatus;
  duplicate: boolean;
}
