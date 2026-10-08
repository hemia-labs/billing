import { MigrationInterface, QueryRunner } from 'typeorm';

export class BalanzLicenseWebhook1791417600000 implements MigrationInterface {
  name = 'BalanzLicenseWebhook1791417600000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE SEQUENCE balanz_webhook_revision_seq AS bigint;
      CREATE TABLE balanz_webhook_deliveries (
        organization_id uuid PRIMARY KEY,
        revision bigint NOT NULL DEFAULT nextval('balanz_webhook_revision_seq'),
        next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        lease_token uuid, lease_until timestamptz,
        attempts integer NOT NULL DEFAULT 0,
        delivered_at timestamptz, last_error varchar(64),
        CHECK ((lease_token IS NULL)=(lease_until IS NULL))
      );
      CREATE INDEX ix_balanz_webhook_due ON balanz_webhook_deliveries(next_attempt_at);
      CREATE FUNCTION queue_balanz_webhook() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      DECLARE item jsonb; org uuid; product text;
      BEGIN
        item:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
        IF TG_TABLE_NAME='subscription_addons' THEN
          SELECT organization_id,product_code INTO org,product FROM public.subscriptions
          WHERE id=(item->>'subscription_id')::uuid;
        ELSE
          org:=(item->>'organization_id')::uuid; product:=item->>'product_code';
        END IF;
        IF product='balanz_cfdi' THEN
          INSERT INTO public.balanz_webhook_deliveries(organization_id) VALUES(org)
          ON CONFLICT(organization_id) DO UPDATE SET
            revision=nextval('public.balanz_webhook_revision_seq'), next_attempt_at=clock_timestamp(), attempts=0;
        END IF;
        RETURN NULL;
      END $$;
      CREATE TRIGGER licenses_balanz_webhook AFTER INSERT OR UPDATE OR DELETE ON licenses FOR EACH ROW EXECUTE FUNCTION queue_balanz_webhook();
      CREATE TRIGGER subscriptions_balanz_webhook AFTER INSERT OR UPDATE OR DELETE ON subscriptions FOR EACH ROW EXECUTE FUNCTION queue_balanz_webhook();
      CREATE TRIGGER addons_balanz_webhook AFTER INSERT OR UPDATE OR DELETE ON subscription_addons FOR EACH ROW EXECUTE FUNCTION queue_balanz_webhook();
      CREATE TRIGGER checkouts_balanz_webhook AFTER INSERT OR UPDATE OR DELETE ON checkout_sessions FOR EACH ROW EXECUTE FUNCTION queue_balanz_webhook();
      INSERT INTO balanz_webhook_deliveries(organization_id)
        SELECT DISTINCT organization_id FROM subscriptions WHERE product_code='balanz_cfdi'
        UNION SELECT DISTINCT organization_id FROM licenses WHERE product_code='balanz_cfdi';
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP TRIGGER licenses_balanz_webhook ON licenses;
      DROP TRIGGER subscriptions_balanz_webhook ON subscriptions;
      DROP TRIGGER addons_balanz_webhook ON subscription_addons;
      DROP TRIGGER checkouts_balanz_webhook ON checkout_sessions;
      DROP FUNCTION queue_balanz_webhook();
      DROP TABLE balanz_webhook_deliveries;
      DROP SEQUENCE balanz_webhook_revision_seq;
    `);
  }
}
