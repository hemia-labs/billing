import type { MigrationInterface, QueryRunner } from 'typeorm';

export class OptionalLegalCheckout1792972800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['checkout_sessions', 'subscriptions']) {
      await queryRunner.query(`ALTER TABLE "${table}"
        ALTER COLUMN legal_acceptance_id DROP NOT NULL,
        ALTER COLUMN accepted_at DROP NOT NULL,
        ALTER COLUMN legal_snapshot_hash DROP NOT NULL`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL refuses rollback while externally managed checkouts have no Legal evidence.
    for (const table of ['checkout_sessions', 'subscriptions']) {
      await queryRunner.query(`ALTER TABLE "${table}"
        ALTER COLUMN legal_acceptance_id SET NOT NULL,
        ALTER COLUMN accepted_at SET NOT NULL,
        ALTER COLUMN legal_snapshot_hash SET NOT NULL`);
    }
  }
}
