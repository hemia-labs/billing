import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveFixedLegalVersions1791244800001 implements MigrationInterface {
  name = 'RemoveFixedLegalVersions1791244800001';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tables = ['checkout_sessions', 'subscriptions', 'audit_logs'];
    await queryRunner.query(
      'LOCK TABLE "checkout_sessions", "subscriptions", "audit_logs" IN ACCESS EXCLUSIVE MODE',
    );
    for (const table of tables) {
      const [result] = (await queryRunner.query(`
        SELECT EXISTS (
          SELECT 1 FROM "${table}"
          WHERE NULLIF(BTRIM(terms_version), '') IS NOT NULL
             OR NULLIF(BTRIM(privacy_version), '') IS NOT NULL
             OR NULLIF(BTRIM(refund_policy_version), '') IS NOT NULL
        ) AS "hasValues"
      `)) as { hasValues: boolean }[];
      if (result.hasValues) {
        throw new Error(
          `Cannot remove Legal version columns: ${table} has values`,
        );
      }
    }
    for (const table of tables) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          DROP COLUMN "terms_version",
          DROP COLUMN "privacy_version",
          DROP COLUMN "refund_policy_version"
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['checkout_sessions', 'subscriptions', 'audit_logs']) {
      const definition =
        table === 'audit_logs'
          ? 'varchar(50)'
          : "varchar(50) NOT NULL DEFAULT ''";
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD COLUMN "terms_version" ${definition},
          ADD COLUMN "privacy_version" ${definition},
          ADD COLUMN "refund_policy_version" ${definition}
      `);
      if (table !== 'audit_logs') {
        await queryRunner.query(`
          ALTER TABLE "${table}"
            ALTER COLUMN "terms_version" DROP DEFAULT,
            ALTER COLUMN "privacy_version" DROP DEFAULT,
            ALTER COLUMN "refund_policy_version" DROP DEFAULT
        `);
      }
    }
  }
}
