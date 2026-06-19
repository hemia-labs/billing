import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BillingWebhookEventEntity } from '../billing-shared';
import {
  BillingProvider,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '../billing-shared';
import { PaypalClientService } from '../paypal';
import { BillingSubscriptionPaymentsProcessorService } from './billing-subscription-payments-processor.service';
import { PaypalEventResource } from './types';
import {
  BillingWebhookProcessResult,
  PaypalWebhookHeaders,
} from './types';

@Injectable()
export class BillingWebhooksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly paypal: PaypalClientService,
    private readonly processor: BillingSubscriptionPaymentsProcessorService,
    @InjectRepository(BillingWebhookEventEntity)
    private readonly webhookEvents: Repository<BillingWebhookEventEntity>,
  ) {}

  async processPaypalWebhook(
    headers: PaypalWebhookHeaders,
    payload: Record<string, unknown>,
  ): Promise<BillingWebhookProcessResult> {
    this.validateHeaders(headers);
    const providerEventId = this.requiredString(payload.id, 'id');
    const eventType = this.requiredString(payload.event_type, 'event_type');
    const resource = this.getResource(payload);
    const resourceId = this.stringOrNull(resource.id);

    const verification = await this.paypal.verifyWebhook({
      transmissionId: headers.transmissionId,
      transmissionTime: headers.transmissionTime,
      certUrl: headers.certUrl,
      authAlgo: headers.authAlgo,
      transmissionSig: headers.transmissionSig,
      webhookEvent: payload,
    });

    if (!verification.verified) {
      const event = await this.saveUnverifiedEvent({
        providerEventId,
        eventType,
        resourceId,
        transmissionId: headers.transmissionId,
        payload,
      });

      return this.toResult(event, false);
    }

    return this.dataSource.transaction(async (manager) => {
      const event = await this.getOrCreateLockedEvent(manager, {
        providerEventId,
        eventType,
        resourceId,
        transmissionId: headers.transmissionId,
        payload,
      });

      if (
        event.processingStatus === WebhookProcessingStatus.Processed ||
        event.processingStatus === WebhookProcessingStatus.Ignored
      ) {
        return this.toResult(event, true);
      }

      event.verificationStatus = WebhookVerificationStatus.Verified;
      event.processingStatus = WebhookProcessingStatus.Pending;
      event.errorMessage = null;
      event.payloadJson = payload;
      event.transmissionId = headers.transmissionId;

      try {
        const result = await this.processor.process(manager, {
          eventId: event.id,
          providerEventId,
          eventType,
          resource,
        });

        event.processingStatus = result.processingStatus;
        event.processedAt = new Date();
        event.errorMessage = result.note ?? null;
        const saved = await manager
          .getRepository(BillingWebhookEventEntity)
          .save(event);
        return this.toResult(saved, false);
      } catch (error) {
        event.processingStatus = WebhookProcessingStatus.Failed;
        event.processedAt = new Date();
        event.errorMessage = this.getErrorMessage(error);
        const saved = await manager
          .getRepository(BillingWebhookEventEntity)
          .save(event);
        return this.toResult(saved, false);
      }
    });
  }

  private validateHeaders(headers: PaypalWebhookHeaders): void {
    const missingHeader = Object.entries(headers).find(
      ([, value]) => typeof value !== 'string' || !value.trim(),
    );

    if (missingHeader) {
      throw new BadRequestException(`Missing PayPal header: ${missingHeader[0]}`);
    }
  }

  private async saveUnverifiedEvent(input: {
    providerEventId: string;
    eventType: string;
    resourceId: string | null;
    transmissionId: string;
    payload: Record<string, unknown>;
  }): Promise<BillingWebhookEventEntity> {
    const existing = await this.webhookEvents.findOne({
      where: { providerEventId: input.providerEventId },
    });

    const event =
      existing ??
      this.webhookEvents.create({
        provider: BillingProvider.Paypal,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        receivedAt: new Date(),
      });

    if (
      existing?.processingStatus === WebhookProcessingStatus.Processed ||
      existing?.processingStatus === WebhookProcessingStatus.Ignored
    ) {
      return existing;
    }

    event.resourceId = input.resourceId;
    event.transmissionId = input.transmissionId;
    event.verificationStatus = WebhookVerificationStatus.Failed;
    event.processingStatus = WebhookProcessingStatus.Failed;
    event.payloadJson = input.payload;
    event.errorMessage = 'PayPal webhook signature verification failed';
    event.processedAt = new Date();

    return this.webhookEvents.save(event);
  }

  private async getOrCreateLockedEvent(
    manager: EntityManager,
    input: {
      providerEventId: string;
      eventType: string;
      resourceId: string | null;
      transmissionId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<BillingWebhookEventEntity> {
    const events = manager.getRepository(BillingWebhookEventEntity);
    const existing = await events.findOne({
      where: { providerEventId: input.providerEventId },
      lock: { mode: 'pessimistic_write' },
    });

    if (existing) return existing;

    const event = events.create({
      provider: BillingProvider.Paypal,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      resourceId: input.resourceId,
      transmissionId: input.transmissionId,
      verificationStatus: WebhookVerificationStatus.Verified,
      processingStatus: WebhookProcessingStatus.Pending,
      payloadJson: input.payload,
      errorMessage: null,
      receivedAt: new Date(),
      processedAt: null,
    });

    return events.save(event);
  }

  private getResource(payload: Record<string, unknown>): PaypalEventResource {
    const resource = this.asRecord(payload.resource);

    if (!resource) {
      throw new BadRequestException('PayPal webhook resource is required');
    }

    return resource;
  }

  private requiredString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`PayPal webhook ${fieldName} is required`);
    }

    return value;
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return 'PayPal webhook processing failed';
  }

  private toResult(
    event: BillingWebhookEventEntity,
    duplicate: boolean,
  ): BillingWebhookProcessResult {
    return {
      eventId: event.id,
      providerEventId: event.providerEventId,
      processingStatus: event.processingStatus,
      duplicate,
    };
  }
}
