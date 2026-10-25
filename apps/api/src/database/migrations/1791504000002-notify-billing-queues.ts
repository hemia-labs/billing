import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotifyBillingQueues1791504000002 implements MigrationInterface {
  name = 'NotifyBillingQueues1791504000002';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE FUNCTION notify_billing_queue() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        PERFORM pg_notify(TG_ARGV[0], '');
        RETURN NULL;
      END $$;
      CREATE TRIGGER notify_paypal_cancellations
        AFTER INSERT ON paypal_cancellation_jobs
        FOR EACH ROW EXECUTE FUNCTION notify_billing_queue('billing_paypal_cancellations');
      CREATE TRIGGER notify_balanz_deliveries_insert
        AFTER INSERT ON balanz_webhook_deliveries
        FOR EACH ROW EXECUTE FUNCTION notify_billing_queue('billing_balanz_deliveries');
      CREATE TRIGGER notify_balanz_deliveries_update
        AFTER UPDATE OF revision ON balanz_webhook_deliveries
        FOR EACH ROW WHEN (NEW.revision IS DISTINCT FROM OLD.revision
          AND NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token)
        EXECUTE FUNCTION notify_billing_queue('billing_balanz_deliveries');
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP TRIGGER notify_paypal_cancellations ON paypal_cancellation_jobs;
      DROP TRIGGER notify_balanz_deliveries_insert ON balanz_webhook_deliveries;
      DROP TRIGGER notify_balanz_deliveries_update ON balanz_webhook_deliveries;
      DROP FUNCTION notify_billing_queue();
    `);
  }
}
