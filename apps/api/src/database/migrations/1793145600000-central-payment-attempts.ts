import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CentralPaymentAttempts1793145600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE payment_attempts (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, product_code varchar(80) NOT NULL,
      created_by_issuer varchar(512) NOT NULL, created_by_client_id varchar(200) NOT NULL,
      request_hash varchar(64) NOT NULL, request_payload jsonb NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','rejected')),
      receipt jsonb NOT NULL DEFAULT '{}'::jsonb, lease_token uuid, lease_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      'CREATE INDEX "IDX_payment_attempts_pending" ON payment_attempts(updated_at) WHERE status=\'pending\'',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE payment_attempts');
  }
}
