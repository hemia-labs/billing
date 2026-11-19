import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderPriceConnections1794355200002 implements MigrationInterface {
  name = 'ProviderPriceConnections1794355200002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE provider_prices ADD COLUMN connection_scope varchar(10) NOT NULL DEFAULT 'unassigned', ADD COLUMN provider_connection_id uuid NULL REFERENCES paypal_connections(id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE provider_prices ADD CONSTRAINT "CHK_provider_prices_connection_scope" CHECK ((connection_scope IN ('unassigned','global') AND provider_connection_id IS NULL) OR (connection_scope='connection' AND provider_connection_id IS NOT NULL AND provider='paypal'))`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_provider_prices_plan_price_provider_unique"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_provider_prices_scope_active_unique" ON provider_prices(plan_price_id,provider,connection_scope,COALESCE(provider_connection_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE status='active'`,
    );
    await queryRunner.query(
      `CREATE TABLE addon_provider_prices (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), addon_id uuid NOT NULL REFERENCES addons(id) ON DELETE RESTRICT, provider provider_prices_provider_enum NOT NULL, connection_scope varchar(10) NOT NULL DEFAULT 'unassigned', provider_connection_id uuid NULL REFERENCES paypal_connections(id) ON DELETE RESTRICT, provider_product_id varchar(150), provider_price_id varchar(150), provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb, status provider_prices_status_enum NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT "CHK_addon_provider_prices_connection_scope" CHECK ((connection_scope IN ('unassigned','global') AND provider_connection_id IS NULL) OR (connection_scope='connection' AND provider_connection_id IS NOT NULL AND provider='paypal')))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_addon_provider_prices_scope_active_unique" ON addon_provider_prices(addon_id,provider,connection_scope,COALESCE(provider_connection_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE status='active'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_addon_provider_prices_addon_id" ON addon_provider_prices(addon_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_addon_provider_prices_provider_price_id" ON addon_provider_prices(provider_price_id)`,
    );
    // Existing remote IDs have no authoritative app identity. Preserve them without guessing.
    await queryRunner.query(
      `INSERT INTO addon_provider_prices(addon_id,provider,provider_price_id,connection_scope) SELECT id,provider::text::provider_prices_provider_enum,provider_plan_id,'unassigned' FROM addons WHERE provider_plan_id IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `LOCK TABLE provider_prices, addon_provider_prices, addons IN ACCESS EXCLUSIVE MODE`,
    );
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM provider_prices WHERE connection_scope<>'unassigned') OR EXISTS(SELECT 1 FROM provider_prices GROUP BY plan_price_id,provider HAVING count(*)>1) OR EXISTS(SELECT 1 FROM addon_provider_prices m LEFT JOIN addons a ON a.id=m.addon_id WHERE m.connection_scope<>'unassigned' OR m.provider::text<>a.provider::text OR m.provider_price_id IS DISTINCT FROM a.provider_plan_id OR m.provider_product_id IS NOT NULL OR m.provider_metadata<>'{}'::jsonb OR m.status<>'active') OR EXISTS(SELECT 1 FROM addon_provider_prices GROUP BY addon_id HAVING count(*)>1) THEN
        RAISE EXCEPTION 'Provider price rollback requires explicit mapping reconciliation';
      END IF;
    END $$`);
    await queryRunner.query(`DROP TABLE addon_provider_prices`);
    await queryRunner.query(
      `DROP INDEX "IDX_provider_prices_scope_active_unique"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_provider_prices_plan_price_provider_unique" ON provider_prices(plan_price_id,provider)`,
    );
    await queryRunner.query(
      `ALTER TABLE provider_prices DROP CONSTRAINT "CHK_provider_prices_connection_scope", DROP COLUMN provider_connection_id, DROP COLUMN connection_scope`,
    );
  }
}
