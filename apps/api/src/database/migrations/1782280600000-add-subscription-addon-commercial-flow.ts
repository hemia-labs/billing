import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionAddonCommercialFlow1782280600000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."subscription_addons_status_enum" ADD VALUE IF NOT EXISTS 'failed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription_addons" ADD "provider_subscription_id" character varying(180)`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription_addons" ADD "idempotency_key" character varying(120)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subscription_addons_provider_subscription_id" ON "subscription_addons" ("provider_subscription_id") WHERE "provider_subscription_id" IS NOT NULL AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subscription_addons_subscription_idempotency_key" ON "subscription_addons" ("subscription_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL AND "deleted_at" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscription_addons_subscription_idempotency_key"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscription_addons_provider_subscription_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription_addons" DROP COLUMN "idempotency_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription_addons" DROP COLUMN "provider_subscription_id"`,
    );
  }
}
