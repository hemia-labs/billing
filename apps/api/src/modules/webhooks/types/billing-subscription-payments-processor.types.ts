import { WebhookProcessingStatus } from '../../billing-shared';

export type PaypalEventResource = Record<string, unknown>;

export interface BillingWebhookProcessorInput {
  eventId: string;
  providerEventId: string;
  eventType: string;
  resource: PaypalEventResource;
}

export interface BillingWebhookProcessorResult {
  processingStatus: WebhookProcessingStatus;
  note?: string;
}
