import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('billing_usage_counters')
@Index('IDX_billing_usage_counters_organization_product_key_unique', [
  'organizationId',
  'productCode',
  'key',
], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class BillingUsageCounterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'product_code', length: 80 })
  productCode: string;

  @Column({ length: 120 })
  key: string;

  @Column({ name: 'current_value', type: 'int', default: 0 })
  currentValue: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
