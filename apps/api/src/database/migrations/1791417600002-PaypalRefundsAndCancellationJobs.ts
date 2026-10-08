import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaypalRefundsAndCancellationJobs1791417600002 implements MigrationInterface {
  name = 'PaypalRefundsAndCancellationJobs1791417600002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        ADD COLUMN period_start timestamptz,
        ADD COLUMN period_end timestamptz;

      UPDATE payments p
         SET period_start = COALESCE(
               p.period_start,
               (
                 SELECT (event.payload_json #>> '{resource,billing_info,last_payment,time}')::timestamptz
                   FROM webhook_events event
                  WHERE event.provider::text = p.provider::text
                    AND event.event_type = 'BILLING.SUBSCRIPTION.ACTIVATED'
                    AND event.payload_json #>> '{resource,id}' = s.provider_subscription_id
                    AND event.payload_json #>> '{resource,billing_info,last_payment,time}' IS NOT NULL
                    AND (event.payload_json #>> '{resource,billing_info,last_payment,time}')::timestamptz = p.paid_at
                  ORDER BY event.received_at DESC
                  LIMIT 1
               ),
               CASE WHEN s.current_period_start = p.paid_at
                    THEN s.current_period_start END
             ),
             period_end = COALESCE(
               p.period_end,
               (
                 SELECT (event.payload_json #>> '{resource,billing_info,next_billing_time}')::timestamptz
                   FROM webhook_events event
                  WHERE event.provider::text = p.provider::text
                    AND event.event_type = 'BILLING.SUBSCRIPTION.ACTIVATED'
                    AND event.payload_json #>> '{resource,id}' = s.provider_subscription_id
                    AND event.payload_json #>> '{resource,billing_info,last_payment,time}' IS NOT NULL
                    AND (event.payload_json #>> '{resource,billing_info,last_payment,time}')::timestamptz = p.paid_at
                    AND event.payload_json #>> '{resource,billing_info,next_billing_time}' IS NOT NULL
                  ORDER BY event.received_at DESC
                  LIMIT 1
               ),
               CASE WHEN s.current_period_start = p.paid_at
                    THEN COALESCE(s.current_period_end,s.next_billing_time) END
             )
        FROM subscriptions s
       WHERE p.subscription_id = s.id
         AND p.status = 'paid'
         AND p.paid_at IS NOT NULL;

      CREATE TABLE payment_refunds (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        provider varchar(32) NOT NULL CHECK (provider = 'paypal'),
        provider_refund_id varchar(180) NOT NULL,
        payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
        webhook_event_id uuid NOT NULL REFERENCES webhook_events(id) ON DELETE RESTRICT,
        amount numeric(12,2) NOT NULL CHECK (amount > 0),
        currency varchar(3) NOT NULL,
        refunded_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE(provider, provider_refund_id)
      );
      CREATE INDEX ix_payment_refunds_payment_id ON payment_refunds(payment_id);

      CREATE TABLE paypal_cancellation_jobs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id uuid NOT NULL,
        provider_subscription_id varchar(180) NOT NULL UNIQUE,
        target_type varchar(16) NOT NULL CHECK (target_type IN ('subscription','addon')),
        target_subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
        target_addon_id uuid REFERENCES subscription_addons(id) ON DELETE RESTRICT,
        source_payment_refund_id uuid NOT NULL REFERENCES payment_refunds(id) ON DELETE RESTRICT,
        status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        lease_token uuid,
        lease_until timestamptz,
        last_error varchar(64),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
        CHECK ((target_type = 'subscription' AND target_addon_id IS NULL)
            OR (target_type = 'addon' AND target_addon_id IS NOT NULL))
      );
      CREATE INDEX ix_paypal_cancellation_jobs_due
        ON paypal_cancellation_jobs(next_attempt_at,id)
        WHERE status='pending';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE paypal_cancellation_jobs;
      DROP TABLE payment_refunds;
      ALTER TABLE payments DROP COLUMN period_start, DROP COLUMN period_end;
    `);
  }
}
