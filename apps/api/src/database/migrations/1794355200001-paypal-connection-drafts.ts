import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PaypalConnectionDrafts1794355200001 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE paypal_connections ADD COLUMN is_draft boolean NOT NULL DEFAULT false',
    );
    await q.query(
      'CREATE UNIQUE INDEX "IDX_paypal_connections_product_draft" ON paypal_connections(product_id) WHERE is_draft=true',
    );
    await q.query(
      'ALTER TABLE paypal_connections ADD CONSTRAINT "CHK_paypal_connections_draft_inactive" CHECK (NOT is_draft OR (NOT is_current AND NOT enabled))',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    // Held by the migration transaction through the preflight and schema removal.
    await q.query('LOCK TABLE paypal_connections IN ACCESS EXCLUSIVE MODE');
    await q.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM paypal_connections WHERE is_draft=true) THEN
        RAISE EXCEPTION 'PayPal draft rollback requires explicit draft reconciliation';
      END IF;
    END $$`);
    await q.query('DROP INDEX "IDX_paypal_connections_product_draft"');
    await q.query(
      'ALTER TABLE paypal_connections DROP CONSTRAINT "CHK_paypal_connections_draft_inactive"',
    );
    await q.query('ALTER TABLE paypal_connections DROP COLUMN is_draft');
  }
}
