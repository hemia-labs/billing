import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductPaypalConnections1794355200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE paypal_connections (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      name varchar(120) NOT NULL CHECK(length(trim(name))>0),
      environment varchar(7) NOT NULL CHECK(environment IN ('sandbox','live')),
      client_id varchar(255) NOT NULL CHECK(length(trim(client_id))>0),
      client_secret_encrypted text NOT NULL CHECK(length(client_secret_encrypted)>0),
      webhook_id varchar(255) NOT NULL DEFAULT '',
      enabled boolean NOT NULL DEFAULT false, is_current boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK(NOT enabled OR length(trim(webhook_id))>0)
    )`);
    await q.query(
      'CREATE UNIQUE INDEX "IDX_paypal_connections_product_current" ON paypal_connections(product_id) WHERE is_current=true',
    );
    await q.query(
      'ALTER TABLE webhook_events ADD COLUMN provider_connection_id uuid REFERENCES paypal_connections(id) ON DELETE RESTRICT',
    );
    await q.query('DROP INDEX "IDX_webhook_events_provider_event_id_unique"');
    await q.query(
      'CREATE UNIQUE INDEX "IDX_webhook_events_legacy_event_unique" ON webhook_events(provider,provider_event_id) WHERE provider_connection_id IS NULL',
    );
    await q.query(
      'CREATE UNIQUE INDEX "IDX_webhook_events_connection_event_unique" ON webhook_events(provider,provider_connection_id,provider_event_id) WHERE provider_connection_id IS NOT NULL',
    );
    await q.query(
      'DROP INDEX "IDX_subscriptions_provider_subscription_id_unique"',
    );
    await q.query(
      `CREATE UNIQUE INDEX "IDX_subscriptions_provider_connection_unique" ON subscriptions(provider,COALESCE(metadata->>'providerConnectionId','global'),provider_subscription_id) WHERE provider_subscription_id IS NOT NULL AND deleted_at IS NULL`,
    );
    await q.query(
      'DROP INDEX "IDX_subscription_addons_provider_subscription_id"',
    );
    await q.query(
      `CREATE UNIQUE INDEX "IDX_subscription_addons_provider_connection_unique" ON subscription_addons(provider,COALESCE(metadata->>'providerConnectionId','global'),provider_subscription_id) WHERE provider_subscription_id IS NOT NULL AND deleted_at IS NULL`,
    );
    await q.query(
      'ALTER TABLE payment_refunds DROP CONSTRAINT payment_refunds_provider_provider_refund_id_key',
    );
    await q.query(
      'CREATE UNIQUE INDEX "IDX_payment_refunds_payment_provider_refund_unique" ON payment_refunds(provider,payment_id,provider_refund_id)',
    );
    await q.query(
      'ALTER TABLE paypal_cancellation_jobs DROP CONSTRAINT paypal_cancellation_jobs_provider_subscription_id_key',
    );
    await q.query(
      `CREATE UNIQUE INDEX "IDX_paypal_cancellation_jobs_subscription_unique" ON paypal_cancellation_jobs(target_subscription_id) WHERE target_type='subscription'`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "IDX_paypal_cancellation_jobs_addon_unique" ON paypal_cancellation_jobs(target_addon_id) WHERE target_type='addon'`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    // Refuse a lossy rollback rather than discard credentials or merge app histories.
    const [state] = (await q.query(`SELECT
      EXISTS(SELECT 1 FROM paypal_connections)
      OR EXISTS(SELECT 1 FROM webhook_events GROUP BY provider_event_id HAVING count(*)>1)
      OR EXISTS(SELECT 1 FROM subscriptions WHERE provider_subscription_id IS NOT NULL AND deleted_at IS NULL GROUP BY provider_subscription_id HAVING count(*)>1)
      OR EXISTS(SELECT 1 FROM subscription_addons WHERE provider_subscription_id IS NOT NULL AND deleted_at IS NULL GROUP BY provider_subscription_id HAVING count(*)>1)
      OR EXISTS(SELECT 1 FROM payment_refunds GROUP BY provider,provider_refund_id HAVING count(*)>1)
      OR EXISTS(SELECT 1 FROM paypal_cancellation_jobs GROUP BY provider_subscription_id HAVING count(*)>1) AS blocked`)) as Array<{
      blocked: boolean;
    }>;
    if (state.blocked)
      throw new Error(
        'PayPal connection rollback requires explicit reconciliation; existing credentials and histories were preserved',
      );
    await q.query('DROP INDEX "IDX_paypal_cancellation_jobs_addon_unique"');
    await q.query(
      'DROP INDEX "IDX_paypal_cancellation_jobs_subscription_unique"',
    );
    await q.query(
      'ALTER TABLE paypal_cancellation_jobs ADD CONSTRAINT paypal_cancellation_jobs_provider_subscription_id_key UNIQUE(provider_subscription_id)',
    );
    await q.query(
      'DROP INDEX "IDX_payment_refunds_payment_provider_refund_unique"',
    );
    await q.query(
      'ALTER TABLE payment_refunds ADD CONSTRAINT payment_refunds_provider_provider_refund_id_key UNIQUE(provider,provider_refund_id)',
    );
    await q.query(
      'DROP INDEX "IDX_subscription_addons_provider_connection_unique"',
    );
    await q.query(
      'CREATE UNIQUE INDEX "IDX_subscription_addons_provider_subscription_id" ON subscription_addons(provider_subscription_id) WHERE provider_subscription_id IS NOT NULL AND deleted_at IS NULL',
    );
    await q.query('DROP INDEX "IDX_subscriptions_provider_connection_unique"');
    await q.query(
      'CREATE UNIQUE INDEX "IDX_subscriptions_provider_subscription_id_unique" ON subscriptions(provider_subscription_id) WHERE provider_subscription_id IS NOT NULL AND deleted_at IS NULL',
    );
    await q.query('DROP INDEX "IDX_webhook_events_connection_event_unique"');
    await q.query('DROP INDEX "IDX_webhook_events_legacy_event_unique"');
    await q.query(
      'CREATE UNIQUE INDEX "IDX_webhook_events_provider_event_id_unique" ON webhook_events(provider_event_id)',
    );
    await q.query(
      'ALTER TABLE webhook_events DROP COLUMN provider_connection_id',
    );
    await q.query('DROP TABLE paypal_connections');
  }
}
