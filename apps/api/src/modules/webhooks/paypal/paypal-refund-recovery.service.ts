import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { PaypalClientService } from '../../paypal/paypal-client.service';

const REFUND_TYPES = ['PAYMENT.SALE.REFUNDED', 'PAYMENT.CAPTURE.REFUNDED'];
const HOUR_MS = 60 * 60 * 1000;
const MAX_PAGES = 20;

@Injectable()
export class PaypalRefundRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PaypalRefundRecoveryService.name);
  private readonly retryAfter = new Map<string, number>();
  private running?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly paypal: PaypalClientService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    void this.recover();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.running;
  }

  @Cron('*/15 * * * *', { name: 'paypal-refund-delivery-recovery' })
  recover(): Promise<void> {
    if (this.running) return this.running;
    if (this.stopping) return Promise.resolve();
    this.running = this.scanConnections()
      .catch((error: unknown) => {
        const reason =
          error instanceof Error &&
          /^(PayPal recovery HTTP \d{3}|Invalid PayPal (event list|next page|pagination URL|recovery response))$/.test(
            error.message,
          )
            ? error.message
            : 'PayPal recovery request failed';
        this.logger.error({
          event: 'billing_paypal_refund_recovery_failed',
          reason,
        });
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async scanConnections(): Promise<void> {
    for (const connection of await this.paypal.recoveryConnections()) {
      if (this.stopping) return;
      try {
        const client = connection.id
          ? this.paypal.forConnection(connection.id)
          : this.paypal;
        const credentials = await client.credentials();
        if (
          !credentials.clientId ||
          !credentials.clientSecret ||
          !credentials.webhookId
        )
          continue;
        await this.scan(connection.id, client, credentials);
      } catch (error) {
        const reason =
          error instanceof Error &&
          /^(PayPal recovery HTTP \d{3}|Invalid PayPal (event list|next page|pagination URL|recovery response))$/.test(
            error.message,
          )
            ? error.message
            : 'PayPal recovery request failed';
        this.logger.error({
          event: 'billing_paypal_refund_recovery_failed',
          ...(connection.id ? { connectionId: connection.id } : {}),
          reason,
        });
      }
    }
  }

  private async scan(
    connectionId: string | null,
    paypal: PaypalClientService,
    credentials: Awaited<ReturnType<PaypalClientService['credentials']>>,
  ): Promise<void> {
    const now = Date.now();
    let examined = 0,
      redeliveries = 0,
      truncated = false;
    for (const [id, until] of this.retryAfter)
      if (until <= now) this.retryAfter.delete(id);
    // PayPal notification history rejects fractional seconds in its date filters.
    const end = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
    // shortcut: PayPal's 30-day history window; older gaps need an explicit operator reconciliation.
    const start = new Date(now - 30 * 24 * HOUR_MS)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    for (const type of REFUND_TYPES) {
      let next: string | undefined;
      for (let page = 0; page < MAX_PAGES && !this.stopping; page++) {
        const response = await this.listEvents(
          type,
          start,
          end,
          next,
          paypal,
          credentials,
        );
        if (!Array.isArray(response.events))
          throw new Error('Invalid PayPal event list');
        examined += response.events.length;
        for (const value of response.events) {
          if (this.stopping) return;
          const event = this.record(value);
          if (event?.event_type !== type || !this.id(event.id)) continue;
          const captureId = this.captureId(event, credentials.environment);
          if (
            !captureId ||
            (this.retryAfter.get(`${connectionId ?? 'global'}:${event.id}`) ??
              0) > Date.now()
          )
            continue;
          const owned = await this.dataSource.query<Array<{ id: string }>>(
            `SELECT p.id FROM payments p
             WHERE p.provider='paypal' AND p.provider_capture_id=$1
               AND COALESCE(p.metadata->>'providerConnectionId','global')=COALESCE($3::text,'global')
               AND NOT EXISTS (SELECT 1 FROM webhook_events w
                 WHERE w.provider='paypal' AND w.provider_event_id=$2 AND w.provider_connection_id IS NOT DISTINCT FROM $3::uuid)
             LIMIT 1`,
            [captureId, event.id, connectionId],
          );
          if (!owned.length) continue;
          this.retryAfter.set(
            `${connectionId ?? 'global'}:${event.id}`,
            Date.now() + HOUR_MS,
          );
          try {
            // Re-delivery preserves the existing signature verification and durable processing path.
            await this.request(
              `/v1/notifications/webhooks-events/${encodeURIComponent(event.id)}/resend`,
              {
                method: 'POST',
                body: JSON.stringify({
                  webhook_ids: [credentials.webhookId],
                }),
              },
              paypal,
              credentials.baseUrl,
            );
            redeliveries++;
            this.logger.warn({
              event: 'billing_paypal_refund_redelivery_requested',
              providerEventId: event.id,
            });
          } catch {
            this.logger.error({
              event: 'billing_paypal_refund_redelivery_failed',
              providerEventId: event.id,
            });
          }
        }
        const links = Array.isArray(response.links) ? response.links : [];
        const nextLink = links
          .map((value) => this.record(value))
          .find((link) => link?.rel === 'next');
        if (!nextLink) break;
        if (typeof nextLink.href !== 'string')
          throw new Error('Invalid PayPal next page');
        next = nextLink.href;
        if (page === MAX_PAGES - 1) {
          truncated = true;
          this.logger.error({
            event: 'billing_paypal_refund_recovery_page_limit',
            eventType: type,
            maxPages: MAX_PAGES,
          });
        }
      }
    }
    if (!this.stopping && !truncated)
      this.logger.log({
        event: 'billing_paypal_refund_recovery_completed',
        examined,
        redeliveries,
      });
  }

  private async listEvents(
    type: string,
    start: string,
    end: string,
    next: string | undefined,
    paypal: PaypalClientService,
    credentials: Awaited<ReturnType<PaypalClientService['credentials']>>,
  ): Promise<Record<string, unknown>> {
    const base = new URL(credentials.baseUrl);
    const url = new URL(next ?? '/v1/notifications/webhooks-events', base);
    const hosts =
      credentials.environment === 'live'
        ? ['api.paypal.com', 'api-m.paypal.com']
        : ['api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'];
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !hosts.includes(url.hostname) ||
      url.pathname !== '/v1/notifications/webhooks-events'
    )
      throw new Error('Invalid PayPal pagination URL');
    url.searchParams.set('event_type', type);
    url.searchParams.set('start_time', start);
    url.searchParams.set('end_time', end);
    url.searchParams.set('page_size', '100');
    return this.request(
      url.pathname + url.search,
      { method: 'GET' },
      paypal,
      credentials.baseUrl,
    );
  }

  private async request(
    path: string,
    init: RequestInit,
    paypal: PaypalClientService,
    baseUrl: string,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(baseUrl + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${await paypal.getAccessToken()}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`PayPal recovery HTTP ${response.status}`);
    const body: unknown = await response.json();
    const result = this.record(body);
    if (!result) throw new Error('Invalid PayPal recovery response');
    return result;
  }

  private captureId(
    event: Record<string, unknown>,
    environment: string,
  ): string | undefined {
    const resource = this.record(event.resource);
    if (!resource) return;
    if (event.event_type === 'PAYMENT.SALE.REFUNDED')
      return this.id(resource.sale_id) ? resource.sale_id : undefined;
    const related = this.record(
      this.record(resource.supplementary_data)?.related_ids,
    );
    for (const value of [related?.capture_id, resource.capture_id])
      if (this.id(value)) return value;
    if (!Array.isArray(resource.links)) return;
    const hosts =
      environment === 'live'
        ? ['api.paypal.com', 'api-m.paypal.com']
        : ['api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'];
    for (const value of resource.links) {
      const link = this.record(value);
      if (link?.rel !== 'up' || typeof link.href !== 'string') continue;
      try {
        const url = new URL(link.href);
        const match = /^\/v2\/payments\/captures\/([A-Za-z0-9]+)$/.exec(
          url.pathname,
        );
        if (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.port &&
          !url.search &&
          !url.hash &&
          hosts.includes(url.hostname) &&
          match
        )
          return match[1];
      } catch {
        /* Untrusted or unrelated links never identify a payment. */
      }
    }
  }

  private id(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9-]{1,180}$/.test(value);
  }
  private record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }
}
