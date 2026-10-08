import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizePaypalWebhookQueue1791504000001 implements MigrationInterface {
  name = 'OptimizePaypalWebhookQueue1791504000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX ix_webhook_events_paypal_due;
      CREATE INDEX ix_webhook_events_paypal_due
        ON webhook_events(next_retry_at, received_at, id)
        WHERE provider = 'paypal'
          AND verification_status = 'verified'
          AND requires_manual_review = false
          AND processing_status IN ('pending', 'processing');
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX ix_webhook_events_paypal_due;
      CREATE INDEX ix_webhook_events_paypal_due
        ON webhook_events(next_retry_at, received_at)
        WHERE provider = 'paypal'
          AND verification_status = 'verified'
          AND requires_manual_review = false;
    `);
  }
}
