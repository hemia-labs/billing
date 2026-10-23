import { WebhookProcessingStatus } from '../../billing-shared';
import type { PaypalSubscriptionDetails } from '../../paypal/types';

export type PaypalEventResource = Record<string, unknown>;

export interface BillingWebhookProcessorInput {
  eventId: string;
  providerEventId: string;
  eventType: string;
  eventCreatedAt?: string;
  resource: PaypalEventResource;
}

export interface BillingWebhookProcessorResult {
  processingStatus: WebhookProcessingStatus;
  note?: string;
}

export type BillingWebhookProcessorContext = {
  paypalSubscription?: PaypalSubscriptionDetails;
};
