import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

export class BillingServiceClients1791244800000 implements MigrationInterface {
  name = 'BillingServiceClients1791244800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'billing_service_clients',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'client_id', type: 'character varying', length: '120' },
          { name: 'policy', type: 'jsonb' },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
        ],
        indices: [
          {
            name: 'IDX_billing_service_clients_client_id',
            columnNames: ['client_id'],
            isUnique: true,
          },
        ],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('billing_service_clients');
  }
}
