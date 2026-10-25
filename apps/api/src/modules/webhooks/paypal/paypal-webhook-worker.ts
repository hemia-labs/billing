import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { ClientConfig } from 'pg';
import { DataSource } from 'typeorm';
import { BillingAuditService } from '../../audit';
import { BillingProvider, WebhookProcessingStatus } from '../../billing-shared';
import { BillingSubscriptionPaymentsProcessorService } from './billing-subscription-payments-processor.service';
import type { BillingWebhookProcessorInput } from '../types';

const CHANNEL = 'billing_paypal_webhooks';
const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 15;

type PaypalWebhookJob = {
  id: string;
  provider_event_id: string;
  event_type: string;
  payload_json: Record<string, unknown>;
  attempts: number;
  lease_token: string;
};

type ListenerDatabaseOptions = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  ssl?: ClientConfig['ssl'];
  extra?: { options?: unknown };
};

@Injectable()
export class PaypalWebhookWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PaypalWebhookWorker.name);
  private listener?: Client;
  private connecting?: Promise<void>;
  private reconnectTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private reconnectDelay = 1_000;
  private running?: Promise<void>;
  private requested = false;
  private stopping = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly processor: BillingSubscriptionPaymentsProcessorService,
    private readonly audit: BillingAuditService,
  ) {}

  onApplicationBootstrap(): void {
    this.connectListener();
  }

  @Cron('*/5 * * * *', { name: 'paypal-webhook-recovery' })
  recover(): void {
    this.wake();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.connecting;
    const listener = this.listener;
    this.listener = undefined;
    await listener?.end().catch(() => undefined);
    await this.running;
  }

  private connectListener(): void {
    if (this.stopping || this.listener || this.connecting) return;
    this.connecting = this.openListener().finally(() => {
      this.connecting = undefined;
    });
  }

  private async openListener(): Promise<void> {
    const options = this.dataSource
      .options as unknown as ListenerDatabaseOptions;
    const clientConfig: ClientConfig = {
      host: options.host,
      port: options.port,
      user: options.username,
      password: options.password,
      database: options.database,
      ssl: options.ssl,
      connectionTimeoutMillis: 10_000,
      options:
        typeof options.extra?.options === 'string'
          ? options.extra.options
          : undefined,
    };
    const client = new Client(clientConfig);
    this.listener = client;
    client.on('notification', (message) => {
      if (message.channel === CHANNEL) this.wake();
    });
    client.on('error', () => this.listenerDisconnected(client));
    client.on('end', () => this.listenerDisconnected(client));

    try {
      await client.connect();
      if (this.stopping) {
        await client.end();
        return;
      }
      await client.query(`LISTEN ${CHANNEL}`);
      this.reconnectDelay = 1_000;
      this.logger.log({ event: 'billing_paypal_webhook_listener_ready' });
      this.wake();
    } catch {
      this.listenerDisconnected(client);
      await client.end().catch(() => undefined);
    }
  }

  private listenerDisconnected(client: Client): void {
    if (this.listener !== client) return;
    this.listener = undefined;
    if (this.stopping) return;
    this.logger.warn({ event: 'billing_paypal_webhook_listener_disconnected' });
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectListener();
    }, delay);
    this.reconnectTimer.unref();
  }

  private wake(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.requested = true;
    if (this.running || this.stopping) return;
    this.running = this.drain()
      .catch(() => {
        this.logger.error({ event: 'billing_paypal_webhook_cycle_failed' });
      })
      .finally(() => {
        this.running = undefined;
        if (this.requested && !this.stopping) this.wake();
      });
  }

  private async drain(): Promise<void> {
    while (!this.stopping) {
      this.requested = false;
      const job = await this.claim();
      if (!job) {
        await this.scheduleNextAttempt();
        return;
      }
      await this.processJob(job);
    }
  }

  private async scheduleNextAttempt(): Promise<void> {
    const [next] = await this.dataSource.query<
      Array<{ delay_ms: number | null }>
    >(
      `SELECT EXTRACT(EPOCH FROM (MIN(GREATEST(next_retry_at,
                COALESCE(locked_until,next_retry_at))) - clock_timestamp())) * 1000 AS delay_ms
         FROM webhook_events
        WHERE provider='paypal' AND verification_status='verified'
          AND requires_manual_review=false
          AND processing_status IN ('pending','processing')`,
    );
    if (this.stopping || next?.delay_ms == null) return;
    this.retryTimer = setTimeout(
      () => this.wake(),
      Math.max(100, Math.min(Number(next.delay_ms), 2_147_483_647)),
    );
    this.retryTimer.unref();
  }

  private async claim(): Promise<PaypalWebhookJob | null> {
    const token = randomUUID();
    return this.dataSource.transaction(async (manager) => {
      const result = await manager.queryRunner!.query(
        `
        WITH candidate AS (
          SELECT id
            FROM webhook_events
           WHERE provider='paypal'
             AND verification_status='verified'
             AND requires_manual_review=false
             AND processing_status IN ('pending','processing')
             AND next_retry_at<=clock_timestamp()
             AND (lease_token IS NULL OR locked_until<=clock_timestamp())
           ORDER BY next_retry_at,received_at,id
           LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        UPDATE webhook_events event
           SET processing_status='processing',attempts=attempts+1,
               lease_token=$1,
               locked_until=clock_timestamp()+($2 * interval '1 second')
          FROM candidate
         WHERE event.id=candidate.id
        RETURNING event.id,event.provider_event_id,event.event_type,
                  event.payload_json,event.attempts,event.lease_token
        `,
        [token, LEASE_SECONDS],
        true,
      );
      return (result.records as PaypalWebhookJob[])[0] ?? null;
    });
  }

  private async processJob(job: PaypalWebhookJob): Promise<void> {
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.renew(job)
        .catch(() => undefined)
        .finally(() => {
          renewing = false;
        });
    }, 30_000);
    heartbeat.unref();

    try {
      const input: BillingWebhookProcessorInput = {
        eventId: job.id,
        providerEventId: job.provider_event_id,
        eventType: job.event_type,
        eventCreatedAt:
          typeof job.payload_json.create_time === 'string'
            ? job.payload_json.create_time
            : undefined,
        resource: this.resource(job.payload_json),
      };
      // PayPal I/O happens before the transaction that changes financial state.
      const context = await this.processor.prepare(input);
      await this.dataSource.transaction(async (manager) => {
        const owned = await manager.query<Array<{ id: string }>>(
          `SELECT id FROM webhook_events
            WHERE id=$1 AND lease_token=$2 AND processing_status='processing'
              AND locked_until>clock_timestamp()
            FOR UPDATE`,
          [job.id, job.lease_token],
        );
        if (!owned.length) return;
        await manager.query(
          `UPDATE webhook_events
              SET locked_until=clock_timestamp()+($3 * interval '1 second')
            WHERE id=$1 AND lease_token=$2`,
          [job.id, job.lease_token, LEASE_SECONDS],
        );

        const result = await this.processor.process(manager, input, context);
        if (
          result.processingStatus === WebhookProcessingStatus.Failed ||
          result.processingStatus === WebhookProcessingStatus.Pending
        ) {
          throw new Error(
            result.note ?? 'PayPal webhook processing incomplete',
          );
        }

        const updated = await manager.queryRunner!.query(
          `UPDATE webhook_events
              SET processing_status=$3,error_message=$4,processed_at=clock_timestamp(),
                  lease_token=NULL,locked_until=NULL
            WHERE id=$1 AND lease_token=$2
            RETURNING id`,
          [
            job.id,
            job.lease_token,
            result.processingStatus,
            result.note ?? null,
          ],
          true,
        );
        if (!updated.records.length)
          throw new Error('PayPal webhook lease was lost');
      });
    } catch (error) {
      await this.recordFailure(job, error).catch(() => {
        this.logger.error({
          event: 'billing_paypal_webhook_failure_persist_failed',
          webhookEventId: job.id,
          attempt: job.attempts,
        });
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async renew(job: PaypalWebhookJob): Promise<void> {
    await this.dataSource.query(
      `UPDATE webhook_events
          SET locked_until=clock_timestamp()+($3 * interval '1 second')
        WHERE id=$1 AND lease_token=$2 AND processing_status='processing'
          AND locked_until>clock_timestamp()`,
      [job.id, job.lease_token, LEASE_SECONDS],
    );
  }

  private async recordFailure(
    job: PaypalWebhookJob,
    error: unknown,
  ): Promise<void> {
    const message = this.errorMessage(error);
    const manualReview = job.attempts >= MAX_ATTEMPTS;
    const delaySeconds = Math.min(
      3_600,
      5 * 2 ** Math.min(job.attempts - 1, 10),
    );
    await this.dataSource.transaction(async (manager) => {
      const updated = await manager.queryRunner!.query(
        `UPDATE webhook_events
            SET processing_status=$3,error_message=$4,
                next_retry_at=CASE WHEN $5 THEN clock_timestamp()
                  ELSE clock_timestamp()+($6 * interval '1 second') END,
                requires_manual_review=$5,lease_token=NULL,locked_until=NULL,
                processed_at=clock_timestamp()
          WHERE id=$1 AND lease_token=$2
            AND locked_until>clock_timestamp()
          RETURNING id`,
        [
          job.id,
          job.lease_token,
          manualReview
            ? WebhookProcessingStatus.Failed
            : WebhookProcessingStatus.Pending,
          message,
          manualReview,
          delaySeconds,
        ],
        true,
      );
      if (!updated.records.length || !manualReview) return;
      await this.audit.record({
        manager,
        action: 'billing.webhook.manual_review_required',
        resourceType: 'billing_webhook_event',
        resourceId: job.id,
        provider: BillingProvider.Paypal,
        metadata: {
          webhookEventId: job.id,
          providerEventId: job.provider_event_id,
          eventType: job.event_type,
          attemptCount: job.attempts,
          requiresManualReview: true,
          outcome: 'failed',
        },
      });
    });
    this.logger.warn({
      event: manualReview
        ? 'billing_paypal_webhook_manual_review_required'
        : 'billing_paypal_webhook_retry_scheduled',
      webhookEventId: job.id,
      attempt: job.attempts,
    });
  }

  private resource(payload: Record<string, unknown>): Record<string, unknown> {
    const resource = payload.resource;
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
      throw new Error('PayPal webhook resource is invalid');
    }
    return resource as Record<string, unknown>;
  }

  private errorMessage(error: unknown): string {
    const message =
      error instanceof Error ? error.message : 'Processing failed';
    return message.replace(/[\r\n]+/g, ' ').slice(0, 2_000);
  }
}
