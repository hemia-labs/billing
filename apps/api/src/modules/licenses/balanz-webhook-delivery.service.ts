import { Cron } from '@nestjs/schedule';
import { BillingQueueWakeup } from '../webhooks/billing-queue-wakeup';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { BillingLicensesService } from './billing-licenses.service';

@Injectable()
export class BalanzWebhookDeliveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BalanzWebhookDeliveryService.name);
  private wakeup: BillingQueueWakeup;
  private stopping = false;

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly licenses: BillingLicensesService,
  ) {
    this.wakeup = new BillingQueueWakeup(
      this.db,
      'billing_balanz_deliveries',
      () => this.deliver(),
      `SELECT EXTRACT(EPOCH FROM (MIN(GREATEST(next_attempt_at,
        COALESCE(lease_until,next_attempt_at))) - clock_timestamp())) * 1000 AS delay_ms
        FROM balanz_webhook_deliveries `,
    );
  }

  onApplicationBootstrap() {
    if (!this.config.get<string>('BALANZ_WEBHOOK_URL')) return;
    this.wakeup.onApplicationBootstrap();
  }

  @Cron('*/5 * * * *')
  recover(): void {
    if (!this.config.get<string>('BALANZ_WEBHOOK_URL')) return;
    this.wakeup.recover();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.wakeup.onApplicationShutdown();
  }

  private async deliver() {
    const url = this.config.getOrThrow<string>('BALANZ_WEBHOOK_URL');
    const secret = this.config.getOrThrow<string>('BALANZ_WEBHOOK_SECRET');
    while (!this.stopping) {
      const token = randomUUID();
      const [rows] = await this.db.query<
        [
          Array<{
            organization_id: string;
            revision: string;
            attempts: number;
          }>,
          number,
        ]
      >(
        `
        WITH candidate AS (
          SELECT organization_id FROM balanz_webhook_deliveries
          WHERE next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp())
          ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED
        ) UPDATE balanz_webhook_deliveries d SET lease_token=$1,
          lease_until=clock_timestamp()+interval '90 seconds',revision=nextval('balanz_webhook_revision_seq')
        FROM candidate c WHERE d.organization_id=c.organization_id RETURNING d.organization_id,d.revision,d.attempts`,
        [token],
      );
      const item = rows[0];
      if (!item) return;
      let delivered = false;
      try {
        const license = await this.licenses.resolveLicense(
          item.organization_id,
          'balanz_cfdi',
        );
        const checkouts = await this.db.query<Array<Record<string, unknown>>>(
          `
          SELECT c.id AS "checkoutId",s.id AS "subscriptionId",c.status AS "checkoutStatus",s.status AS "subscriptionStatus"
          FROM checkout_sessions c LEFT JOIN subscriptions s
            ON s.id=CASE WHEN c.metadata->>'subscriptionId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN (c.metadata->>'subscriptionId')::uuid END
            AND s.organization_id=c.organization_id AND s.product_code=c.product_code
          WHERE c.organization_id=$1 AND c.product_code='balanz_cfdi' AND c.deleted_at IS NULL
          ORDER BY c.created_at DESC LIMIT 100`,
          [item.organization_id],
        );
        const body = JSON.stringify({
          type: 'billing.license.updated',
          organizationId: item.organization_id,
          productCode: 'balanz_cfdi',
          revision: item.revision,
          license,
          checkouts,
        });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac('sha256', secret)
          .update(timestamp + '.' + body)
          .digest('hex');
        const response = await fetch(url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            'Content-Type': 'application/json',
            'x-billing-timestamp': timestamp,
            'x-billing-signature': signature,
          },
          body,
        });
        if (!response.ok) throw new Error('delivery_rejected');
        const receipt = (await response.json()) as { received?: boolean };
        if (receipt.received !== true) throw new Error('invalid_receipt');
        delivered = true;
      } catch {
        this.logger.warn({
          event: 'balanz_webhook_delivery_failed',
          organizationId: item.organization_id,
        });
      }
      // A concurrent commit advances revision: release the lease and deliver again.
      // Periodic confirmation keeps the existing 24-hour fail-closed access policy.
      await this.db.query(
        `UPDATE balanz_webhook_deliveries SET lease_token=NULL,lease_until=NULL,
        next_attempt_at=CASE WHEN revision<>$3 THEN clock_timestamp()
          WHEN $4 THEN clock_timestamp()+interval '6 hours'
          ELSE clock_timestamp()+($5 * interval '1 second') END,
        delivered_at=CASE WHEN $4 THEN clock_timestamp() ELSE delivered_at END,
        attempts=CASE WHEN revision<>$3 OR $4 THEN 0 ELSE attempts+1 END,
        last_error=CASE WHEN $4 THEN NULL ELSE 'DELIVERY_FAILED' END
        WHERE organization_id=$1 AND lease_token=$2`,
        [
          item.organization_id,
          token,
          item.revision,
          delivered,
          Math.min(3600, 5 * 2 ** Math.min(item.attempts, 10)),
        ],
      );
    }
  }
}
