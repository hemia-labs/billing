import { Cron } from '@nestjs/schedule';
import { BillingQueueWakeup } from '../billing-queue-wakeup';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { BillingAuditService } from '../../audit';
import { BillingProvider } from '../../billing-shared';
import { PaypalClientService } from '../../paypal';

type CancellationJob = {
  id: string;
  organization_id: string;
  provider_subscription_id: string;
  target_type: 'subscription' | 'addon';
  target_subscription_id: string;
  target_addon_id: string | null;
  source_payment_refund_id: string;
  lease_token: string;
  attempts: number;
};

@Injectable()
export class PaypalCancellationWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PaypalCancellationWorker.name);
  private wakeup: BillingQueueWakeup;
  private stopping = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly paypal: PaypalClientService,
    private readonly audit: BillingAuditService,
  ) {
    this.wakeup = new BillingQueueWakeup(
      this.dataSource,
      'billing_paypal_cancellations',
      () => this.drain(),
      `SELECT EXTRACT(EPOCH FROM (MIN(GREATEST(next_attempt_at,
        COALESCE(lease_until,next_attempt_at))) - clock_timestamp())) * 1000 AS delay_ms
        FROM paypal_cancellation_jobs WHERE status='pending'`,
    );
  }

  onApplicationBootstrap(): void {
    this.wakeup.onApplicationBootstrap();
  }

  @Cron('*/5 * * * *')
  recover(): void {
    this.wakeup.recover();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.wakeup.onApplicationShutdown();
  }

  private async drain(): Promise<void> {
    while (!this.stopping) {
      const job = await this.claim();
      if (!job) return;

      let completed = false;
      try {
        const subscription = await this.paypal.getSubscription(
          job.provider_subscription_id,
        );
        if (subscription.status === 'CANCELLED') {
          completed = true;
        } else {
          try {
            await this.paypal.cancelSubscription({
              providerSubscriptionId: job.provider_subscription_id,
              reason: 'Subscription cancelled after a completed PayPal refund',
            });
            completed = true;
          } catch {
            const current = await this.paypal.getSubscription(
              job.provider_subscription_id,
            );
            completed = current.status === 'CANCELLED';
          }
        }
      } catch {
        completed = false;
      }

      await this.finish(job, completed);
      if (!completed) {
        this.logger.warn({
          event: 'paypal_subscription_cancellation_retry',
          jobId: job.id,
          attempt: job.attempts + 1,
        });
      }
    }
  }

  private async claim(): Promise<CancellationJob | null> {
    const token = randomUUID();
    return this.dataSource.transaction(async (manager) => {
      const [rows] = await manager.query<[CancellationJob[], number]>(
        `
        WITH candidate AS (
           SELECT id
             FROM paypal_cancellation_jobs
            WHERE status='pending'
              AND next_attempt_at<=clock_timestamp()
              AND (lease_until IS NULL OR lease_until<=clock_timestamp())
            ORDER BY next_attempt_at,id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
         UPDATE paypal_cancellation_jobs job
            SET lease_token=$1,
                lease_until=clock_timestamp()+interval '90 seconds',
                updated_at=clock_timestamp()
           FROM candidate
          WHERE job.id=candidate.id
         RETURNING job.id,job.organization_id,job.provider_subscription_id,
                   job.target_type,job.target_subscription_id,job.target_addon_id,
                   job.source_payment_refund_id,job.lease_token,job.attempts
        `,
        [token],
      );
      return rows[0] ?? null;
    });
  }

  private async finish(
    job: CancellationJob,
    completed: boolean,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const [rows] = await manager.query<[Array<{ id: string }>, number]>(
        `
        UPDATE paypal_cancellation_jobs
            SET status=CASE WHEN $3 THEN 'completed' ELSE 'pending' END,
                attempts=attempts+1,
                next_attempt_at=CASE WHEN $3 THEN next_attempt_at
                  ELSE clock_timestamp() +
                    LEAST(3600,5 * power(2,LEAST(attempts,10))) * interval '1 second'
                END,
                lease_token=NULL,
                lease_until=NULL,
                last_error=CASE WHEN $3 THEN NULL ELSE 'PAYPAL_CANCELLATION_FAILED' END,
                updated_at=clock_timestamp()
          WHERE id=$1 AND lease_token=$2
          RETURNING id
        `,
        [job.id, job.lease_token, completed],
      );
      if (!completed || !rows.length) return;

      await this.audit.record({
        manager,
        organizationId: job.organization_id,
        action: 'billing.refund.subscription_cancellation_completed',
        resourceType: 'paypal_cancellation_job',
        resourceId: job.id,
        provider: BillingProvider.Paypal,
        metadata: {
          cancellationJobId: job.id,
          paymentRefundId: job.source_payment_refund_id,
          subscriptionId: job.target_subscription_id,
          subscriptionAddonId: job.target_addon_id,
          outcome: 'completed',
        },
      });
    });
  }
}
