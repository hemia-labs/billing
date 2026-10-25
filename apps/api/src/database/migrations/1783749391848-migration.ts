import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1783749391848 implements MigrationInterface {
  name = 'Migration1783749391848';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."products_status_enum" AS ENUM('active', 'inactive')`,
    );
    await queryRunner.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(80) NOT NULL, "name" character varying(120) NOT NULL, "description" text, "status" "public"."products_status_enum" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_products_code_active_unique" ON "products"  ("code") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."addons_billing_interval_enum" AS ENUM('monthly', 'yearly')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."addons_type_enum" AS ENUM('recurring')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."addons_pricing_model_enum" AS ENUM('flat', 'per_unit')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."addons_provider_enum" AS ENUM('paypal', 'stripe', 'mercado_pago', 'manual_transfer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."addons_status_enum" AS ENUM('active', 'inactive', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TABLE "addons" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "product_code" character varying(80) NOT NULL, "code" character varying(100) NOT NULL, "name" character varying(120) NOT NULL, "description" text, "unit_price" numeric(12,2) NOT NULL, "currency" character varying(3) NOT NULL, "billing_interval" "public"."addons_billing_interval_enum" NOT NULL, "type" "public"."addons_type_enum" NOT NULL, "pricing_model" "public"."addons_pricing_model_enum" NOT NULL, "min_quantity" integer NOT NULL DEFAULT '1', "max_quantity" integer, "provider" "public"."addons_provider_enum" NOT NULL, "provider_plan_id" character varying(150), "entitlement_effects" jsonb NOT NULL DEFAULT '{"numeric":{},"features":{}}'::jsonb, "status" "public"."addons_status_enum" NOT NULL DEFAULT 'active', "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_cd49fb3dc0558f02cb6fe6cc138" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_addons_product_code_code_active_unique" ON "addons"  ("product_code", "code") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_addons_status" ON "addons"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_addons_code" ON "addons"  ("code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_addons_product_code" ON "addons"  ("product_code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_addons_product_id" ON "addons"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_provider_enum" AS ENUM('paypal', 'stripe', 'mercado_pago', 'manual_transfer')`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "actor_user_id" uuid, "action" character varying(120) NOT NULL, "resource_type" character varying(120) NOT NULL, "resource_id" uuid, "provider" "public"."audit_logs_provider_enum", "legal_acceptance_id" character varying(150), "terms_version" character varying(50), "privacy_version" character varying(50), "refund_policy_version" character varying(50), "accepted_at" TIMESTAMP WITH TIME ZONE, "legal_snapshot_hash" character varying(150), "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_legal_acceptance_id" ON "audit_logs"  ("legal_acceptance_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_provider" ON "audit_logs"  ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_resource" ON "audit_logs"  ("resource_type", "resource_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_actor_user_id" ON "audit_logs"  ("actor_user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_organization_id" ON "audit_logs"  ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."feature_definitions_value_type_enum" AS ENUM('boolean', 'integer', 'decimal', 'string', 'json')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."feature_definitions_aggregation_strategy_enum" AS ENUM('replace', 'sum', 'max', 'min', 'boolean_or', 'boolean_and')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."feature_definitions_status_enum" AS ENUM('active', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TABLE "feature_definitions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "code" character varying(120) NOT NULL, "name" character varying(120) NOT NULL, "description" text, "value_type" "public"."feature_definitions_value_type_enum" NOT NULL, "unit" character varying(50), "aggregation_strategy" "public"."feature_definitions_aggregation_strategy_enum" NOT NULL DEFAULT 'replace', "is_metered" boolean NOT NULL DEFAULT false, "status" "public"."feature_definitions_status_enum" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ec6c36ca9aae80e0eecfb58eb29" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_feature_definitions_product_code_unique" ON "feature_definitions"  ("product_id", "code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_feature_definitions_product_id" ON "feature_definitions"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "plan_entitlements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan_version_id" uuid NOT NULL, "feature_id" uuid NOT NULL, "value_json" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_457e3d0a6af4aaa511844067f33" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_plan_entitlements_version_feature_unique" ON "plan_entitlements"  ("plan_version_id", "feature_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plan_entitlements_feature_id" ON "plan_entitlements"  ("feature_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plan_entitlements_plan_version_id" ON "plan_entitlements"  ("plan_version_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."provider_prices_provider_enum" AS ENUM('paypal', 'stripe', 'mercado_pago', 'manual_transfer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."provider_prices_status_enum" AS ENUM('active', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TABLE "provider_prices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan_price_id" uuid NOT NULL, "provider" "public"."provider_prices_provider_enum" NOT NULL, "provider_product_id" character varying(150), "provider_price_id" character varying(150), "provider_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "status" "public"."provider_prices_status_enum" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1f6a52279963c3e1db11e55dc42" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_provider_prices_provider_price_id" ON "provider_prices"  ("provider_price_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_provider_prices_plan_price_provider_unique" ON "provider_prices"  ("plan_price_id", "provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_provider_prices_plan_price_id" ON "provider_prices"  ("plan_price_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."plan_prices_billing_interval_enum" AS ENUM('month', 'year')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."plan_prices_status_enum" AS ENUM('active', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TABLE "plan_prices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan_version_id" uuid NOT NULL, "code" character varying(100) NOT NULL, "billing_interval" "public"."plan_prices_billing_interval_enum" NOT NULL, "billing_interval_count" integer NOT NULL DEFAULT '1', "currency" character varying(3) NOT NULL, "amount" numeric(12,2) NOT NULL, "status" "public"."plan_prices_status_enum" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_69b05dce9891d42a3d0fc77eec1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plan_prices_status" ON "plan_prices"  ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_plan_prices_plan_version_code_unique" ON "plan_prices"  ("plan_version_id", "code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plan_prices_plan_version_id" ON "plan_prices"  ("plan_version_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."plan_versions_status_enum" AS ENUM('draft', 'published', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TABLE "plan_versions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan_id" uuid NOT NULL, "version" integer NOT NULL, "status" "public"."plan_versions_status_enum" NOT NULL DEFAULT 'draft', "effective_from" TIMESTAMP WITH TIME ZONE, "effective_until" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_dd2f605d45f2679a86a7c1c5b20" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plan_versions_status" ON "plan_versions"  ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_plan_versions_plan_version_unique" ON "plan_versions"  ("plan_id", "version") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plan_versions_plan_id" ON "plan_versions"  ("plan_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."plans_status_enum" AS ENUM('active', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TABLE "plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "code" character varying(100) NOT NULL, "name" character varying(120) NOT NULL, "description" text, "status" "public"."plans_status_enum" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_3720521a81c7c24fe9b7202ba61" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plans_status" ON "plans"  ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_plans_product_code_unique" ON "plans"  ("product_id", "code") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plans_code" ON "plans"  ("code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plans_product_id" ON "plans"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."checkout_sessions_provider_enum" AS ENUM('paypal', 'stripe', 'mercado_pago', 'manual_transfer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."checkout_sessions_status_enum" AS ENUM('created', 'pending', 'approved', 'cancelled', 'expired', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "checkout_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "user_id" uuid NOT NULL, "product_code" character varying(80) NOT NULL, "plan_id" uuid NOT NULL, "plan_price_id" uuid, "provider_price_id" uuid, "plan_price_code" character varying(100), "provider" "public"."checkout_sessions_provider_enum" NOT NULL, "provider_checkout_url" text, "status" "public"."checkout_sessions_status_enum" NOT NULL DEFAULT 'created', "success_url" text NOT NULL, "cancel_url" text NOT NULL, "legal_acceptance_id" character varying(150) NOT NULL, "terms_version" character varying(50) NOT NULL, "privacy_version" character varying(50) NOT NULL, "refund_policy_version" character varying(50) NOT NULL, "accepted_at" TIMESTAMP WITH TIME ZONE NOT NULL, "legal_snapshot_hash" character varying(150) NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5730b2bbc190203a94941d82bd1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_checkout_sessions_status" ON "checkout_sessions"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_checkout_sessions_provider" ON "checkout_sessions"  ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_checkout_sessions_plan_id" ON "checkout_sessions"  ("plan_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_checkout_sessions_product_code" ON "checkout_sessions"  ("product_code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_checkout_sessions_organization_id" ON "checkout_sessions"  ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."customers_provider_enum" AS ENUM('paypal', 'stripe', 'mercado_pago', 'manual_transfer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."customers_status_enum" AS ENUM('active', 'blocked', 'deleted')`,
    );
    await queryRunner.query(
      `CREATE TABLE "customers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "provider" "public"."customers_provider_enum" NOT NULL, "provider_payer_id" character varying(150), "payer_email" character varying(255), "billing_email" character varying(255), "country" character varying(2), "status" "public"."customers_status_enum" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_customers_provider_payer_id" ON "customers"  ("provider_payer_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_customers_provider" ON "customers"  ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_customers_organization_id" ON "customers"  ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscriptions_provider_enum" AS ENUM('paypal', 'stripe', 'mercado_pago', 'manual_transfer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('pending', 'active', 'past_due', 'suspended', 'cancelled', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "billing_customer_id" uuid NOT NULL, "plan_id" uuid NOT NULL, "product_code" character varying(80) NOT NULL, "plan_code" character varying(100) NOT NULL, "plan_price_id" uuid, "provider_price_id" uuid, "plan_price_code" character varying(100), "provider" "public"."subscriptions_provider_enum" NOT NULL, "provider_subscription_id" character varying(150), "status" "public"."subscriptions_status_enum" NOT NULL DEFAULT 'pending', "current_period_start" TIMESTAMP WITH TIME ZONE, "current_period_end" TIMESTAMP WITH TIME ZONE, "next_billing_time" TIMESTAMP WITH TIME ZONE, "cancel_at_period_end" boolean NOT NULL DEFAULT false, "grace_until" TIMESTAMP WITH TIME ZONE, "legal_acceptance_id" character varying(150) NOT NULL, "terms_version" character varying(50) NOT NULL, "privacy_version" character varying(50) NOT NULL, "refund_policy_version" character varying(50) NOT NULL, "accepted_at" TIMESTAMP WITH TIME ZONE NOT NULL, "legal_snapshot_hash" character varying(150) NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subscriptions_provider_subscription_id_unique" ON "subscriptions"  ("provider_subscription_id") WHERE "provider_subscription_id" IS NOT NULL AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscriptions_status" ON "subscriptions"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscriptions_provider" ON "subscriptions"  ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscriptions_plan_code" ON "subscriptions"  ("plan_code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscriptions_product_code" ON "subscriptions"  ("product_code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscriptions_organization_id" ON "subscriptions"  ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."entitlements_status_enum" AS ENUM('active', 'stale')`,
    );
    await queryRunner.query(
      `CREATE TABLE "entitlements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "subscription_id" uuid NOT NULL, "product_code" character varying(80) NOT NULL, "key" character varying(120) NOT NULL, "value" integer NOT NULL, "status" "public"."entitlements_status_enum" NOT NULL DEFAULT 'active', "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6a45cb6f5747d49365a879bffde" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_entitlements_subscription_key_unique" ON "entitlements"  ("subscription_id", "key") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_entitlements_organization_product" ON "entitlements"  ("organization_id", "product_code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_entitlements_subscription_id" ON "entitlements"  ("subscription_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."webhook_events_provider_enum" AS ENUM('paypal', 'stripe', 'mercado_pago', 'manual_transfer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."webhook_events_verification_status_enum" AS ENUM('verified', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."webhook_events_processing_status_enum" AS ENUM('pending', 'processed', 'failed', 'ignored')`,
    );
    await queryRunner.query(
      `CREATE TABLE "webhook_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "provider" "public"."webhook_events_provider_enum" NOT NULL, "provider_event_id" character varying(180) NOT NULL, "event_type" character varying(180) NOT NULL, "resource_id" character varying(180), "transmission_id" character varying(180), "verification_status" "public"."webhook_events_verification_status_enum" NOT NULL, "processing_status" "public"."webhook_events_processing_status_enum" NOT NULL DEFAULT 'pending', "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb, "error_message" text, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "processed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_4cba37e6a0acb5e1fc49c34ebfd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_events_processing_status" ON "webhook_events"  ("processing_status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_events_resource_id" ON "webhook_events"  ("resource_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_events_event_type" ON "webhook_events"  ("event_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_events_provider" ON "webhook_events"  ("provider") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_webhook_events_provider_event_id_unique" ON "webhook_events"  ("provider_event_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payments_provider_enum" AS ENUM('paypal', 'stripe', 'mercado_pago', 'manual_transfer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payments_status_enum" AS ENUM('pending', 'paid', 'failed', 'refunded', 'reversed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "subscription_id" uuid, "provider" "public"."payments_provider_enum" NOT NULL, "provider_payment_id" character varying(180), "provider_capture_id" character varying(180), "amount" numeric(12,2) NOT NULL, "currency" character varying(3) NOT NULL, "status" "public"."payments_status_enum" NOT NULL DEFAULT 'pending', "paid_at" TIMESTAMP WITH TIME ZONE, "raw_event_id" uuid, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_status" ON "payments"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_provider_capture_id" ON "payments"  ("provider_capture_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_provider_payment_id" ON "payments"  ("provider_payment_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_provider" ON "payments"  ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_subscription_id" ON "payments"  ("subscription_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_organization_id" ON "payments"  ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."invoices_status_enum" AS ENUM('pending', 'issued', 'cancelled', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "payment_id" uuid NOT NULL, "cfdi_uuid" character varying(120), "rfc" character varying(13) NOT NULL, "legal_name" character varying(255) NOT NULL, "tax_regime" character varying(20) NOT NULL, "cfdi_use" character varying(20) NOT NULL, "subtotal" numeric(12,2) NOT NULL, "tax_amount" numeric(12,2) NOT NULL, "total" numeric(12,2) NOT NULL, "currency" character varying(3) NOT NULL, "status" "public"."invoices_status_enum" NOT NULL DEFAULT 'pending', "xml_url" text, "pdf_url" text, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "issued_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_668cef7c22a427fd822cc1be3ce" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invoices_status" ON "invoices"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invoices_cfdi_uuid" ON "invoices"  ("cfdi_uuid") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invoices_payment_id" ON "invoices"  ("payment_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invoices_organization_id" ON "invoices"  ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."licenses_status_enum" AS ENUM('active', 'grace', 'suspended', 'revoked')`,
    );
    await queryRunner.query(
      `CREATE TABLE "licenses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "product_id" uuid NOT NULL, "product_code" character varying(80) NOT NULL, "subscription_id" uuid, "plan_code" character varying(100) NOT NULL, "license_key_hash" character varying(255), "status" "public"."licenses_status_enum" NOT NULL DEFAULT 'active', "seats_limit" integer NOT NULL DEFAULT '0', "usage_limit" integer, "features_json" jsonb NOT NULL DEFAULT '{}'::jsonb, "valid_until" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_da5021501ce80efa03de6f40086" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_licenses_status" ON "licenses"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_licenses_subscription_id" ON "licenses"  ("subscription_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_licenses_product_code" ON "licenses"  ("product_code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_licenses_organization_id" ON "licenses"  ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscription_addons_status_enum" AS ENUM('pending_payment', 'active', 'failed', 'scheduled_cancel', 'cancelled', 'blocked')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscription_addons_billing_interval_enum" AS ENUM('monthly', 'yearly')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscription_addons_pricing_model_enum" AS ENUM('flat', 'per_unit')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscription_addons_provider_enum" AS ENUM('paypal', 'stripe', 'mercado_pago', 'manual_transfer')`,
    );
    await queryRunner.query(
      `CREATE TABLE "subscription_addons" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "subscription_id" uuid NOT NULL, "addon_id" uuid NOT NULL, "addon_code" character varying(100) NOT NULL, "quantity" integer NOT NULL, "status" "public"."subscription_addons_status_enum" NOT NULL DEFAULT 'pending_payment', "unit_price" numeric(12,2) NOT NULL, "currency" character varying(3) NOT NULL, "billing_interval" "public"."subscription_addons_billing_interval_enum" NOT NULL, "pricing_model" "public"."subscription_addons_pricing_model_enum" NOT NULL, "entitlement_effects" jsonb NOT NULL, "provider" "public"."subscription_addons_provider_enum" NOT NULL, "provider_reference_id" character varying(180), "provider_subscription_id" character varying(180), "idempotency_key" character varying(120), "pending_effective_at" TIMESTAMP WITH TIME ZONE, "current_period_end" TIMESTAMP WITH TIME ZONE, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2648ce4c6031da6cfb93f33665e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subscription_addons_subscription_addon_status_unique" ON "subscription_addons"  ("subscription_id", "addon_id", "status") WHERE "deleted_at" IS NULL AND "status" IN ('pending_payment', 'active')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subscription_addons_subscription_idempotency_key" ON "subscription_addons"  ("subscription_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subscription_addons_provider_subscription_id" ON "subscription_addons"  ("provider_subscription_id") WHERE "provider_subscription_id" IS NOT NULL AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_addons_status" ON "subscription_addons"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_addons_addon_id" ON "subscription_addons"  ("addon_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_addons_subscription_id" ON "subscription_addons"  ("subscription_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tenants_status_enum" AS ENUM('pending', 'provisioning', 'active', 'suspended', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tenants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "code" character varying(80) NOT NULL, "name" character varying(120) NOT NULL, "status" "public"."tenants_status_enum" NOT NULL DEFAULT 'active', "configuration" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_53be67a04681c66b87ee27c9321" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tenants_status" ON "tenants"  ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_tenants_organization_id_unique" ON "tenants"  ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "usage_counters" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "product_code" character varying(80) NOT NULL, "key" character varying(120) NOT NULL, "current_value" integer NOT NULL DEFAULT '0', "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_fb39db314fa8fc2b6653f2f4e31" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_usage_counters_organization_product_key_unique" ON "usage_counters"  ("organization_id", "product_code", "key") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "addons" ADD CONSTRAINT "FK_ee37825d7df7f4ddd35927779dd" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "feature_definitions" ADD CONSTRAINT "FK_bdeefdddb4b25a51d8428a02685" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_entitlements" ADD CONSTRAINT "FK_ffbc6ca2085fdd93d104fe6c668" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_entitlements" ADD CONSTRAINT "FK_d967f1233998b36269700f7de74" FOREIGN KEY ("feature_id") REFERENCES "feature_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_prices" ADD CONSTRAINT "FK_e1cab184aafc77b9e870ea0edc9" FOREIGN KEY ("plan_price_id") REFERENCES "plan_prices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_prices" ADD CONSTRAINT "FK_6271728b74efec0e36a072e0e4f" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_versions" ADD CONSTRAINT "FK_b504a5b710ec5832245809b7bce" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD CONSTRAINT "FK_d69ef64a2077d2159f98e9f6dfb" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout_sessions" ADD CONSTRAINT "FK_cab166ef23f31c99811ca4ef2ad" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout_sessions" ADD CONSTRAINT "FK_3b7180ad11a09a88e7329f1c4a8" FOREIGN KEY ("plan_price_id") REFERENCES "plan_prices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout_sessions" ADD CONSTRAINT "FK_04cd9c44b3be0d81e2e792187e0" FOREIGN KEY ("provider_price_id") REFERENCES "provider_prices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_7e31142da481150691517fe5fcd" FOREIGN KEY ("billing_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_e45fca5d912c3a2fab512ac25dc" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_32070c53993605bd3699f9ec9a6" FOREIGN KEY ("plan_price_id") REFERENCES "plan_prices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_6df4f4659610bfe96a33cc5480a" FOREIGN KEY ("provider_price_id") REFERENCES "provider_prices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "entitlements" ADD CONSTRAINT "FK_466a14443d295327ac3f88cd897" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_75848dfef07fd19027e08ca81d2" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_a370af68b68fee62290893c0946" FOREIGN KEY ("raw_event_id") REFERENCES "webhook_events"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_02781c49b25ceb502571f0315f6" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "licenses" ADD CONSTRAINT "FK_f485cd1b6d59b2a29bf6e4d0601" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "licenses" ADD CONSTRAINT "FK_a33ef3e2a2cf2ccb164a8f28c35" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription_addons" ADD CONSTRAINT "FK_a6967de14fe6bf60070019bea34" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription_addons" ADD CONSTRAINT "FK_a75c88d555c47aec5dd4736829a" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscription_addons" DROP CONSTRAINT "FK_a75c88d555c47aec5dd4736829a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription_addons" DROP CONSTRAINT "FK_a6967de14fe6bf60070019bea34"`,
    );
    await queryRunner.query(
      `ALTER TABLE "licenses" DROP CONSTRAINT "FK_a33ef3e2a2cf2ccb164a8f28c35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "licenses" DROP CONSTRAINT "FK_f485cd1b6d59b2a29bf6e4d0601"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_02781c49b25ceb502571f0315f6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_a370af68b68fee62290893c0946"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_75848dfef07fd19027e08ca81d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "entitlements" DROP CONSTRAINT "FK_466a14443d295327ac3f88cd897"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_6df4f4659610bfe96a33cc5480a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_32070c53993605bd3699f9ec9a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_e45fca5d912c3a2fab512ac25dc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_7e31142da481150691517fe5fcd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout_sessions" DROP CONSTRAINT "FK_04cd9c44b3be0d81e2e792187e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout_sessions" DROP CONSTRAINT "FK_3b7180ad11a09a88e7329f1c4a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout_sessions" DROP CONSTRAINT "FK_cab166ef23f31c99811ca4ef2ad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" DROP CONSTRAINT "FK_d69ef64a2077d2159f98e9f6dfb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_versions" DROP CONSTRAINT "FK_b504a5b710ec5832245809b7bce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_prices" DROP CONSTRAINT "FK_6271728b74efec0e36a072e0e4f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_prices" DROP CONSTRAINT "FK_e1cab184aafc77b9e870ea0edc9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_entitlements" DROP CONSTRAINT "FK_d967f1233998b36269700f7de74"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_entitlements" DROP CONSTRAINT "FK_ffbc6ca2085fdd93d104fe6c668"`,
    );
    await queryRunner.query(
      `ALTER TABLE "feature_definitions" DROP CONSTRAINT "FK_bdeefdddb4b25a51d8428a02685"`,
    );
    await queryRunner.query(
      `ALTER TABLE "addons" DROP CONSTRAINT "FK_ee37825d7df7f4ddd35927779dd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_usage_counters_organization_product_key_unique"`,
    );
    await queryRunner.query(`DROP TABLE "usage_counters"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tenants_organization_id_unique"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_tenants_status"`);
    await queryRunner.query(`DROP TABLE "tenants"`);
    await queryRunner.query(`DROP TYPE "public"."tenants_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscription_addons_subscription_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscription_addons_addon_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscription_addons_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscription_addons_provider_subscription_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscription_addons_subscription_idempotency_key"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscription_addons_subscription_addon_status_unique"`,
    );
    await queryRunner.query(`DROP TABLE "subscription_addons"`);
    await queryRunner.query(
      `DROP TYPE "public"."subscription_addons_provider_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."subscription_addons_pricing_model_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."subscription_addons_billing_interval_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."subscription_addons_status_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_licenses_organization_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_licenses_product_code"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_licenses_subscription_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_licenses_status"`);
    await queryRunner.query(`DROP TABLE "licenses"`);
    await queryRunner.query(`DROP TYPE "public"."licenses_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_invoices_organization_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_invoices_payment_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_invoices_cfdi_uuid"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_invoices_status"`);
    await queryRunner.query(`DROP TABLE "invoices"`);
    await queryRunner.query(`DROP TYPE "public"."invoices_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_payments_organization_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_payments_subscription_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_provider"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_payments_provider_payment_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_payments_provider_capture_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_status"`);
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."payments_provider_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_webhook_events_provider_event_id_unique"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_webhook_events_provider"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_webhook_events_event_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_webhook_events_resource_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_webhook_events_processing_status"`,
    );
    await queryRunner.query(`DROP TABLE "webhook_events"`);
    await queryRunner.query(
      `DROP TYPE "public"."webhook_events_processing_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."webhook_events_verification_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."webhook_events_provider_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_entitlements_subscription_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_entitlements_organization_product"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_entitlements_subscription_key_unique"`,
    );
    await queryRunner.query(`DROP TABLE "entitlements"`);
    await queryRunner.query(`DROP TYPE "public"."entitlements_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscriptions_organization_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscriptions_product_code"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscriptions_plan_code"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_subscriptions_provider"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_subscriptions_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscriptions_provider_subscription_id_unique"`,
    );
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."subscriptions_provider_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_customers_organization_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_customers_provider"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_customers_provider_payer_id"`,
    );
    await queryRunner.query(`DROP TABLE "customers"`);
    await queryRunner.query(`DROP TYPE "public"."customers_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."customers_provider_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_checkout_sessions_organization_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_checkout_sessions_product_code"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_checkout_sessions_plan_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_checkout_sessions_provider"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_checkout_sessions_status"`,
    );
    await queryRunner.query(`DROP TABLE "checkout_sessions"`);
    await queryRunner.query(
      `DROP TYPE "public"."checkout_sessions_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."checkout_sessions_provider_enum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_plans_product_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_plans_code"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_plans_product_code_unique"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_plans_status"`);
    await queryRunner.query(`DROP TABLE "plans"`);
    await queryRunner.query(`DROP TYPE "public"."plans_status_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_plan_versions_plan_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_plan_versions_plan_version_unique"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_plan_versions_status"`);
    await queryRunner.query(`DROP TABLE "plan_versions"`);
    await queryRunner.query(`DROP TYPE "public"."plan_versions_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_plan_prices_plan_version_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_plan_prices_plan_version_code_unique"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_plan_prices_status"`);
    await queryRunner.query(`DROP TABLE "plan_prices"`);
    await queryRunner.query(`DROP TYPE "public"."plan_prices_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."plan_prices_billing_interval_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_provider_prices_plan_price_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_provider_prices_plan_price_provider_unique"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_provider_prices_provider_price_id"`,
    );
    await queryRunner.query(`DROP TABLE "provider_prices"`);
    await queryRunner.query(`DROP TYPE "public"."provider_prices_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."provider_prices_provider_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_plan_entitlements_plan_version_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_plan_entitlements_feature_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_plan_entitlements_version_feature_unique"`,
    );
    await queryRunner.query(`DROP TABLE "plan_entitlements"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_feature_definitions_product_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_feature_definitions_product_code_unique"`,
    );
    await queryRunner.query(`DROP TABLE "feature_definitions"`);
    await queryRunner.query(
      `DROP TYPE "public"."feature_definitions_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."feature_definitions_aggregation_strategy_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."feature_definitions_value_type_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_audit_logs_organization_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_audit_logs_actor_user_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_resource"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_provider"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_audit_logs_legal_acceptance_id"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_provider_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_addons_product_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_addons_product_code"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_addons_code"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_addons_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_addons_product_code_code_active_unique"`,
    );
    await queryRunner.query(`DROP TABLE "addons"`);
    await queryRunner.query(`DROP TYPE "public"."addons_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."addons_provider_enum"`);
    await queryRunner.query(`DROP TYPE "public"."addons_pricing_model_enum"`);
    await queryRunner.query(`DROP TYPE "public"."addons_type_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."addons_billing_interval_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_products_code_active_unique"`,
    );
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP TYPE "public"."products_status_enum"`);
  }
}
