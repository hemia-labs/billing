import { MigrationInterface, QueryRunner } from 'typeorm';

export class GenericLicenseConnections1792627200000 implements MigrationInterface {
  name = 'GenericLicenseConnections1792627200000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE billing_license_receivers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_code varchar(80) NOT NULL UNIQUE,
        url varchar(2048) NOT NULL, audience varchar(255) NOT NULL, resource varchar(2048) NOT NULL,
        enabled boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      DROP TRIGGER licenses_balanz_webhook ON licenses;
      DROP TRIGGER subscriptions_balanz_webhook ON subscriptions;
      DROP TRIGGER addons_balanz_webhook ON subscription_addons;
      DROP TRIGGER checkouts_balanz_webhook ON checkout_sessions;
      DROP FUNCTION queue_balanz_webhook();
      DROP TRIGGER notify_balanz_deliveries_insert ON balanz_webhook_deliveries;
      DROP TRIGGER notify_balanz_deliveries_update ON balanz_webhook_deliveries;
      ALTER TABLE balanz_webhook_deliveries RENAME TO billing_license_deliveries;
      ALTER SEQUENCE balanz_webhook_revision_seq RENAME TO billing_license_revision_seq;
      ALTER INDEX ix_balanz_webhook_due RENAME TO ix_billing_license_due;
      ALTER TABLE billing_license_deliveries ADD COLUMN product_code varchar(80) NOT NULL DEFAULT 'balanz_cfdi';
      ALTER TABLE billing_license_deliveries ALTER COLUMN product_code DROP DEFAULT;
      ALTER TABLE billing_license_deliveries DROP CONSTRAINT balanz_webhook_deliveries_pkey;
      ALTER TABLE billing_license_deliveries ADD PRIMARY KEY (organization_id,product_code);
      UPDATE billing_license_deliveries SET lease_token=NULL,lease_until=NULL;

      CREATE FUNCTION queue_billing_license(org uuid, product text) RETURNS void LANGUAGE sql SET search_path=pg_catalog,public AS $$
        INSERT INTO public.billing_license_deliveries(organization_id,product_code)
          SELECT org,product WHERE org IS NOT NULL AND EXISTS(SELECT 1 FROM public.billing_license_receivers WHERE product_code=product AND enabled)
        ON CONFLICT(organization_id,product_code) DO UPDATE SET
          revision=nextval('public.billing_license_revision_seq'),next_attempt_at=clock_timestamp(),attempts=0;
      $$;
      CREATE FUNCTION queue_billing_license_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      DECLARE item jsonb; org uuid; product text; items jsonb[];
      BEGIN
        items:=CASE WHEN TG_OP='DELETE' THEN ARRAY[to_jsonb(OLD)] WHEN TG_OP='INSERT' THEN ARRAY[to_jsonb(NEW)] ELSE ARRAY[to_jsonb(OLD),to_jsonb(NEW)] END;
        FOREACH item IN ARRAY items LOOP
          IF TG_TABLE_NAME='subscription_addons' THEN
            SELECT organization_id,product_code INTO org,product FROM public.subscriptions WHERE id=(item->>'subscription_id')::uuid;
          ELSE org:=(item->>'organization_id')::uuid; product:=item->>'product_code'; END IF;
          PERFORM public.queue_billing_license(org,product);
        END LOOP;
        RETURN NULL;
      END $$;
      CREATE TRIGGER licenses_delivery AFTER INSERT OR UPDATE OR DELETE ON licenses FOR EACH ROW EXECUTE FUNCTION queue_billing_license_change();
      CREATE TRIGGER subscriptions_delivery AFTER INSERT OR UPDATE OR DELETE ON subscriptions FOR EACH ROW EXECUTE FUNCTION queue_billing_license_change();
      CREATE TRIGGER addons_delivery AFTER INSERT OR UPDATE OR DELETE ON subscription_addons FOR EACH ROW EXECUTE FUNCTION queue_billing_license_change();
      CREATE TRIGGER checkouts_delivery AFTER INSERT OR UPDATE OR DELETE ON checkout_sessions FOR EACH ROW EXECUTE FUNCTION queue_billing_license_change();
      CREATE TRIGGER notify_license_deliveries_insert AFTER INSERT ON billing_license_deliveries FOR EACH ROW EXECUTE FUNCTION notify_billing_queue('billing_license_deliveries');
      CREATE TRIGGER notify_license_deliveries_update AFTER UPDATE OF revision ON billing_license_deliveries
        FOR EACH ROW WHEN (NEW.revision IS DISTINCT FROM OLD.revision AND NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token)
        EXECUTE FUNCTION notify_billing_queue('billing_license_deliveries');
    `);
  }
  down(): Promise<void> {
    throw new Error(
      'Restore the coordinated development snapshot; the retired delivery contract cannot be re-enabled by rollback.',
    );
  }
}
