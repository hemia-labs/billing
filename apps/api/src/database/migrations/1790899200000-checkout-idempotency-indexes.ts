import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CheckoutIdempotencyIndexes1790899200000 implements MigrationInterface {
  name = 'CheckoutIdempotencyIndexes1790899200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates = (await queryRunner.query(`
      SELECT 'active_customers' AS kind FROM customers
      WHERE deleted_at IS NULL
      GROUP BY organization_id, provider HAVING count(*) > 1
      UNION ALL
      SELECT 'checkout_keys' AS kind FROM checkout_sessions
      WHERE metadata ->> 'createdByIssuer' IS NOT NULL
        AND metadata ->> 'createdByClientId' IS NOT NULL
        AND metadata ->> 'idempotencyKey' IS NOT NULL
      GROUP BY organization_id, metadata ->> 'createdByIssuer',
        metadata ->> 'createdByClientId', metadata ->> 'idempotencyKey'
      HAVING count(*) > 1
      LIMIT 1
    `)) as Array<{ kind: string }>;
    if (duplicates.length)
      throw new Error(
        `Reconcile duplicate ${duplicates[0].kind} before applying checkout idempotency indexes`,
      );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_customers_active_organization_provider"
      ON customers (organization_id, provider) WHERE deleted_at IS NULL
    `);
    // Deleted checkouts retain their keys, so deleted_at is not in this predicate.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checkout_sessions_service_idempotency"
      ON checkout_sessions (organization_id, (metadata ->> 'createdByIssuer'),
        (metadata ->> 'createdByClientId'), (metadata ->> 'idempotencyKey'))
      WHERE metadata ->> 'createdByIssuer' IS NOT NULL
        AND metadata ->> 'createdByClientId' IS NOT NULL
        AND metadata ->> 'idempotencyKey' IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX "UQ_checkout_sessions_service_idempotency"',
    );
    await queryRunner.query(
      'DROP INDEX "UQ_customers_active_organization_provider"',
    );
  }
}
