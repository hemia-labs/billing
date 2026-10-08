import { webhookOrganizationSql } from './webhook-organization.sql';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { BillingAuditService } from '../audit';
import {
  BillingAuditLogEntity,
  BillingWebhookEventEntity,
} from '../billing-shared';
import {
  BillingProvider,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '../billing-shared';
import { CatalogPageDto } from '../catalog/dtos';
import { PaypalClientService } from '../paypal';
import { PaypalEventResource } from './types';
import { BillingWebhookProcessResult, PaypalWebhookHeaders } from './types';
import {
  ConsoleWebhookDetailResponseDto,
  ConsoleWebhookResponseDto,
  ListConsoleWebhooksQueryDto,
} from './dtos';

const RETRY_ACTION = 'billing.webhook.manual_retry';
const RETRY_LIMIT = 3;
const RETRY_WINDOW_MINUTES = 15;
const PAYPAL_WEBHOOK_CHANNEL = 'billing_paypal_webhooks';
const RETRYABLE_IGNORED_NOTES = new Set([
  'Subscription not found',
  'Payment subscription not found',
  'Payment not found',
]);

@Injectable()
export class BillingWebhooksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly paypal: PaypalClientService,
    private readonly audit: BillingAuditService,
    @InjectRepository(BillingWebhookEventEntity)
    private readonly webhookEvents: Repository<BillingWebhookEventEntity>,
    @InjectRepository(BillingAuditLogEntity)
    private readonly auditLogs: Repository<BillingAuditLogEntity>,
  ) {}

  async listConsoleWebhooks(
    query: ListConsoleWebhooksQueryDto,
    scope: string[] | null,
  ): Promise<CatalogPageDto<ConsoleWebhookResponseDto>> {
    const builder = this.webhookEvents.createQueryBuilder('webhook');
    if (scope !== null)
      builder.andWhere(
        `${webhookOrganizationSql('webhook')} IN (:...authorizedOrganizations)`,
        { authorizedOrganizations: scope },
      );
    if (query.provider)
      builder.andWhere('webhook.provider = :provider', {
        provider: query.provider,
      });
    if (query.event_type)
      builder.andWhere('webhook.eventType = :eventType', {
        eventType: query.event_type,
      });
    if (query.processing_status)
      builder.andWhere('webhook.processingStatus = :processingStatus', {
        processingStatus: query.processing_status,
      });
    if (query.verification_status)
      builder.andWhere('webhook.verificationStatus = :verificationStatus', {
        verificationStatus: query.verification_status,
      });
    if (query.provider_event_id)
      builder.andWhere('webhook.providerEventId = :providerEventId', {
        providerEventId: query.provider_event_id,
      });
    if (query.resource_id)
      builder.andWhere('webhook.resourceId = :resourceId', {
        resourceId: query.resource_id,
      });
    if (query.received_from)
      builder.andWhere('webhook.receivedAt >= :receivedFrom', {
        receivedFrom: query.received_from,
      });
    if (query.received_to)
      builder.andWhere('webhook.receivedAt <= :receivedTo', {
        receivedTo: query.received_to,
      });

    const [items, total] = await builder
      .orderBy('webhook.receivedAt', 'DESC')
      .addOrderBy('webhook.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return {
      items: items.map((item) => this.toConsoleWebhook(item)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getConsoleWebhook(
    id: string,
  ): Promise<ConsoleWebhookDetailResponseDto> {
    const event = await this.findWebhook(id);
    return this.toConsoleWebhookDetail(event);
  }

  async retryWebhook(
    id: string,
    reason: string,
    actorUserId: string,
    scope: string[] | null,
  ): Promise<ConsoleWebhookDetailResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const events = manager.getRepository(BillingWebhookEventEntity);
      const event = await events.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event)
        throw new NotFoundException('Billing webhook event not found');
      if (event.verificationStatus !== WebhookVerificationStatus.Verified) {
        throw new BadRequestException('Only verified webhooks can be retried');
      }
      if (
        event.processingStatus !== WebhookProcessingStatus.Failed &&
        !this.isRetryableIgnored(event)
      ) {
        throw new BadRequestException(
          'Only failed or unresolved webhooks can be retried',
        );
      }

      const [owner] = await manager.query<
        Array<{ organization_id: string | null }>
      >(
        `SELECT ${webhookOrganizationSql('w')} AS organization_id FROM webhook_events w WHERE w.id=$1`,
        [event.id],
      );
      if (
        scope !== null &&
        (!owner?.organization_id || !scope.includes(owner.organization_id))
      )
        throw new ForbiddenException('Webhook outside authorized scope');
      const retryAttempt = await this.nextRetryAttempt(manager, event.id);
      event.processingStatus = WebhookProcessingStatus.Pending;
      event.attempts = 0;
      event.nextRetryAt = new Date();
      event.lockedUntil = null;
      event.leaseToken = null;
      event.requiresManualReview = false;
      event.errorMessage = null;
      event.processedAt = null;
      const saved = await events.save(event);
      await manager.query('SELECT pg_notify($1, $2)', [
        PAYPAL_WEBHOOK_CHANNEL,
        saved.id,
      ]);
      await this.audit.record({
        manager,
        actorUserId,
        organizationId: owner?.organization_id ?? null,
        action: RETRY_ACTION,
        resourceType: 'billing_webhook_event',
        resourceId: saved.id,
        provider: saved.provider,
        metadata: {
          webhookEventId: saved.id,
          providerEventId: saved.providerEventId,
          eventType: saved.eventType,
          retryReason: reason,
          retryAttempt,
          newStatus: saved.processingStatus,
        },
      });
      return this.toConsoleWebhookDetail(saved);
    });
  }

  async processPaypalWebhook(
    headers: PaypalWebhookHeaders,
    payload: Record<string, unknown>,
  ): Promise<BillingWebhookProcessResult> {
    this.validateHeaders(headers);
    const providerEventId = this.requiredString(payload.id, 'id');
    const eventType = this.requiredString(payload.event_type, 'event_type');
    const resource = this.getResource(payload);
    const resourceId = this.stringOrNull(resource.id);

    const verification = await this.paypal
      .verifyWebhook({
        transmissionId: headers.transmissionId,
        transmissionTime: headers.transmissionTime,
        certUrl: headers.certUrl,
        authAlgo: headers.authAlgo,
        transmissionSig: headers.transmissionSig,
        webhookEvent: payload,
      })
      .catch(() => {
        throw new ServiceUnavailableException(
          'PayPal webhook verification is temporarily unavailable',
        );
      });

    if (!verification.verified) {
      await this.saveUnverifiedEvent({
        providerEventId,
        eventType,
        resourceId,
        transmissionId: headers.transmissionId,
        payload,
      });

      throw new ForbiddenException(
        'PayPal webhook signature verification failed',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const { event, created } = await this.getOrCreateLockedEvent(manager, {
        providerEventId,
        eventType,
        resourceId,
        transmissionId: headers.transmissionId,
        payload,
      });

      if (event.verificationStatus !== WebhookVerificationStatus.Verified) {
        event.verificationStatus = WebhookVerificationStatus.Verified;
        event.eventType = eventType;
        event.resourceId = resourceId;
        event.payloadJson = payload;
        event.transmissionId = headers.transmissionId;
        event.processingStatus = WebhookProcessingStatus.Pending;
        event.attempts = 0;
        event.nextRetryAt = new Date();
        event.lockedUntil = null;
        event.leaseToken = null;
        event.requiresManualReview = false;
        event.errorMessage = null;
        event.processedAt = null;
        await manager.getRepository(BillingWebhookEventEntity).save(event);
      }

      if (
        event.processingStatus === WebhookProcessingStatus.Pending &&
        !event.requiresManualReview
      ) {
        await manager.query('SELECT pg_notify($1, $2)', [
          PAYPAL_WEBHOOK_CHANNEL,
          event.id,
        ]);
      }
      return this.toResult(event, !created);
    });
  }

  private isRetryableIgnored(event: BillingWebhookEventEntity): boolean {
    return (
      event.processingStatus === WebhookProcessingStatus.Ignored &&
      RETRYABLE_IGNORED_NOTES.has(event.errorMessage ?? '')
    );
  }

  private validateHeaders(headers: PaypalWebhookHeaders): void {
    const missingHeader = Object.entries(headers).find(
      ([, value]) => typeof value !== 'string' || !value.trim(),
    );

    if (missingHeader) {
      throw new BadRequestException(
        `Missing PayPal header: ${missingHeader[0]}`,
      );
    }
  }

  private async saveUnverifiedEvent(input: {
    providerEventId: string;
    eventType: string;
    resourceId: string | null;
    transmissionId: string;
    payload: Record<string, unknown>;
  }): Promise<BillingWebhookEventEntity> {
    return this.dataSource.transaction(async (manager) => {
      const events = manager.getRepository(BillingWebhookEventEntity);
      await manager.query(
        `INSERT INTO webhook_events(provider,provider_event_id,event_type,resource_id,transmission_id,verification_status,processing_status,payload_json,error_message,processed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,clock_timestamp())
         ON CONFLICT(provider_event_id) DO NOTHING`,
        [
          BillingProvider.Paypal,
          input.providerEventId,
          input.eventType,
          input.resourceId,
          input.transmissionId,
          WebhookVerificationStatus.Failed,
          WebhookProcessingStatus.Failed,
          JSON.stringify(input.payload),
          'PayPal webhook signature verification failed',
        ],
      );
      const event = await events.findOne({
        where: { providerEventId: input.providerEventId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event) throw new Error('PayPal webhook could not be persisted');
      if (event.verificationStatus === WebhookVerificationStatus.Verified)
        return event;

      event.eventType = input.eventType;
      event.resourceId = input.resourceId;
      event.transmissionId = input.transmissionId;
      event.verificationStatus = WebhookVerificationStatus.Failed;
      event.processingStatus = WebhookProcessingStatus.Failed;
      event.payloadJson = input.payload;
      event.errorMessage = 'PayPal webhook signature verification failed';
      event.processedAt = new Date();
      event.lockedUntil = null;
      event.leaseToken = null;
      event.requiresManualReview = false;
      return events.save(event);
    });
  }

  private async findWebhook(id: string): Promise<BillingWebhookEventEntity> {
    const event = await this.webhookEvents.findOne({ where: { id } });
    if (!event) throw new NotFoundException('Billing webhook event not found');
    return event;
  }

  private async nextRetryAttempt(
    manager: EntityManager,
    webhookEventId: string,
  ): Promise<number> {
    const since = new Date(Date.now() - RETRY_WINDOW_MINUTES * 60 * 1000);
    const recentRetries = await manager
      .getRepository(BillingAuditLogEntity)
      .count({
        where: {
          action: RETRY_ACTION,
          resourceId: webhookEventId,
          createdAt: MoreThanOrEqual(since),
        },
      });
    if (recentRetries >= RETRY_LIMIT) {
      throw new HttpException(
        'Webhook retry rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return recentRetries + 1;
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
  ): Promise<{ event: BillingWebhookEventEntity; created: boolean }> {
    const events = manager.getRepository(BillingWebhookEventEntity);
    const inserted = await manager.query<Array<{ id: string }>>(
      `INSERT INTO webhook_events(provider,provider_event_id,event_type,resource_id,transmission_id,verification_status,processing_status,payload_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT(provider_event_id) DO NOTHING RETURNING id`,
      [
        BillingProvider.Paypal,
        input.providerEventId,
        input.eventType,
        input.resourceId,
        input.transmissionId,
        WebhookVerificationStatus.Verified,
        WebhookProcessingStatus.Pending,
        JSON.stringify(input.payload),
      ],
    );
    const event = await events.findOne({
      where: { providerEventId: input.providerEventId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!event) throw new Error('Persisted PayPal webhook could not be loaded');
    return { event, created: inserted.length > 0 };
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

  private toConsoleWebhook(
    event: BillingWebhookEventEntity,
  ): ConsoleWebhookResponseDto {
    return {
      id: event.id,
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      resourceId: event.resourceId,
      verificationStatus: event.verificationStatus,
      processingStatus: event.processingStatus,
      errorMessage: event.errorMessage,
      attempts: event.attempts,
      nextRetryAt: event.nextRetryAt,
      lockedUntil: event.lockedUntil,
      requiresManualReview: event.requiresManualReview,
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
    };
  }

  private toConsoleWebhookDetail(
    event: BillingWebhookEventEntity,
  ): ConsoleWebhookDetailResponseDto {
    return {
      ...this.toConsoleWebhook(event),
      transmissionId: event.transmissionId,
      references: this.references(event),
    };
  }

  private references(event: BillingWebhookEventEntity): Record<string, string> {
    const resource = this.asRecord(event.payloadJson.resource) ?? {};
    return Object.fromEntries(
      ['id', 'custom_id', 'billing_agreement_id', 'subscription_id']
        .map((key) => [key, resource[key]])
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
    );
  }
}
