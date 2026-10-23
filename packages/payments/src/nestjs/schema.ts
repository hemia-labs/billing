import type { MigrationInterface, QueryRunner } from "typeorm";
/** Register explicitly in the host migration list; module startup never executes DDL. */
export class PaymentsSchema1792886400000 implements MigrationInterface {
  name = "PaymentsSchema1792886400000";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
 CREATE TABLE public.payments_checkout_attempts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, subject_id uuid NOT NULL, product_code varchar(80) NOT NULL,
 idempotency_key varchar(120) NOT NULL, request_hash char(64) NOT NULL, request_payload jsonb NOT NULL,
 status varchar(20) NOT NULL CHECK(status IN ('pending','ready','rejected')),
 checkout_id uuid, subscription_id uuid, checkout_url text, checkout_status text, subscription_status text,
 status_checked_at timestamptz, error_code varchar(100), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT payments_checkout_attempts_request_hash CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT payments_checkout_attempts_payload CHECK(jsonb_typeof(request_payload)='object'),
 CONSTRAINT payments_checkout_attempts_receipt CHECK((status='ready' AND checkout_id IS NOT NULL AND subscription_id IS NOT NULL AND checkout_url IS NOT NULL) OR (status<>'ready' AND checkout_id IS NULL AND subscription_id IS NULL AND checkout_url IS NULL)),
 CONSTRAINT payments_checkout_attempts_error CHECK((status='rejected' AND error_code IS NOT NULL) OR (status<>'rejected' AND error_code IS NULL)),
 CONSTRAINT payments_checkout_attempts_idempotency UNIQUE(organization_id,product_code,idempotency_key)
 );
 CREATE INDEX payments_checkout_attempts_org_created ON public.payments_checkout_attempts(organization_id,product_code,created_at DESC);
 CREATE TABLE public.payments_licenses (
 organization_id uuid NOT NULL, product_code varchar(80) NOT NULL, revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 license jsonb NOT NULL, confirmed_at timestamptz NOT NULL, received_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,product_code)
 );
 REVOKE ALL ON public.payments_checkout_attempts,public.payments_licenses FROM PUBLIC;
 CREATE FUNCTION public.payments_apply_license(org uuid, product text, revision bigint, license jsonb, checkouts jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE applied boolean;
 BEGIN
 IF org IS NULL OR product IS NULL OR length(product)<1 OR revision<=0 OR license->>'productCode' IS DISTINCT FROM product THEN
 RAISE EXCEPTION 'invalid payments webhook'; END IF;
 INSERT INTO public.payments_licenses(organization_id,product_code,revision,license,confirmed_at,received_at,updated_at)
 VALUES(org,product,revision,license,clock_timestamp(),clock_timestamp(),clock_timestamp())
 ON CONFLICT(organization_id,product_code) DO UPDATE SET revision=EXCLUDED.revision,license=EXCLUDED.license,
 confirmed_at=clock_timestamp(),received_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE payments_licenses.revision<EXCLUDED.revision;
 applied:=FOUND;
 IF applied THEN
 UPDATE public.payments_checkout_attempts a SET checkout_status=c."checkoutStatus",subscription_status=c."subscriptionStatus",status_checked_at=clock_timestamp(),updated_at=clock_timestamp()
 FROM jsonb_to_recordset(checkouts) AS c("checkoutId" uuid,"subscriptionId" uuid,"checkoutStatus" text,"subscriptionStatus" text)
 WHERE a.organization_id=org AND a.product_code=product AND a.checkout_id=c."checkoutId" AND a.subscription_id=c."subscriptionId";
 END IF;
 RETURN applied;
 END $$;
 REVOKE ALL ON FUNCTION public.payments_apply_license(uuid,text,bigint,jsonb,jsonb) FROM PUBLIC;
 `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP FUNCTION public.payments_apply_license(uuid,text,bigint,jsonb,jsonb); DROP TABLE public.payments_licenses; DROP TABLE public.payments_checkout_attempts;`,
    );
  }
}
