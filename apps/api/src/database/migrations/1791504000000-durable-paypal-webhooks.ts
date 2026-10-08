import { MigrationInterface, QueryRunner } from 'typeorm';

export class DurablePaypalWebhooks1791504000000 implements MigrationInterface {
  name = 'DurablePaypalWebhooks1791504000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE webhook_events_processing_status_enum ADD VALUE IF NOT EXISTS 'processing';
      ALTER TABLE webhook_events
        ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        ADD COLUMN next_retry_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        ADD COLUMN locked_until timestamptz,
        ADD COLUMN lease_token uuid,
        ADD COLUMN requires_manual_review boolean NOT NULL DEFAULT false,
        ADD CONSTRAINT webhook_events_lease_check
          CHECK ((lease_token IS NULL) = (locked_until IS NULL));
      UPDATE webhook_events
         SET requires_manual_review = true
       WHERE provider = 'paypal'
         AND verification_status = 'verified'
         AND processing_status = 'failed';
      CREATE INDEX ix_webhook_events_paypal_due
        ON webhook_events(next_retry_at, received_at)
        WHERE provider = 'paypal'
          AND verification_status = 'verified'
          AND requires_manual_review = false;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX ix_webhook_events_paypal_due;
      ALTER TABLE webhook_events
        DROP CONSTRAINT webhook_events_lease_check,
        DROP COLUMN requires_manual_review,
        DROP COLUMN lease_token,
        DROP COLUMN locked_until,
        DROP COLUMN next_retry_at,
        DROP COLUMN attempts;
      UPDATE webhook_events
         SET processing_status = 'pending'
       WHERE processing_status = 'processing';
      ALTER TABLE webhook_events ALTER COLUMN processing_status DROP DEFAULT;
      CREATE TYPE webhook_events_processing_status_enum_old AS ENUM
        ('pending', 'processed', 'failed', 'ignored');
      ALTER TABLE webhook_events
        ALTER COLUMN processing_status TYPE webhook_events_processing_status_enum_old
        USING processing_status::text::webhook_events_processing_status_enum_old;
      DROP TYPE webhook_events_processing_status_enum;
      ALTER TYPE webhook_events_processing_status_enum_old
        RENAME TO webhook_events_processing_status_enum;
      ALTER TABLE webhook_events ALTER COLUMN processing_status SET DEFAULT 'pending';
    `);
  }
}
