import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntitlementStatus } from '../enums';
import { BillingSubscriptionEntity } from './billing-subscription.entity';

@Entity('billing_entitlements')
@Index('IDX_billing_entitlements_subscription_id', ['subscriptionId'])
@Index('IDX_billing_entitlements_organization_product', [
  'organizationId',
  'productCode',
])
@Index('IDX_billing_entitlements_subscription_key_unique', ['subscriptionId', 'key'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class BillingEntitlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId: string;

  @ManyToOne(() => BillingSubscriptionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: BillingSubscriptionEntity;

  @Column({ name: 'product_code', length: 80 })
  productCode: string;

  @Column({ length: 120 })
  key: string;

  @Column({ type: 'int' })
  value: number;

  @Column({
    type: 'enum',
    enum: EntitlementStatus,
    default: EntitlementStatus.Active,
  })
  status: EntitlementStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
