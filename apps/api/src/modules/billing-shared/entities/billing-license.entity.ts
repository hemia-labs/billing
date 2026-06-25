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
import { LicenseStatus } from '../enums';
import { BillingProductEntity } from './billing-product.entity';
import { BillingSubscriptionEntity } from './billing-subscription.entity';

@Entity('licenses')
@Index('IDX_licenses_organization_id', ['organizationId'])
@Index('IDX_licenses_product_code', ['productCode'])
@Index('IDX_licenses_subscription_id', ['subscriptionId'])
@Index('IDX_licenses_status', ['status'])
export class BillingLicenseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => BillingProductEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product: BillingProductEntity;

  @Column({ name: 'product_code', length: 80 })
  productCode: string;

  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @ManyToOne(() => BillingSubscriptionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: BillingSubscriptionEntity | null;

  @Column({ name: 'plan_code', length: 100 })
  planCode: string;

  @Column({
    name: 'license_key_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  licenseKeyHash: string | null;

  @Column({
    type: 'enum',
    enum: LicenseStatus,
    default: LicenseStatus.Active,
  })
  status: LicenseStatus;

  @Column({ name: 'seats_limit', type: 'int', default: 0 })
  seatsLimit: number;

  @Column({ name: 'usage_limit', type: 'int', nullable: true })
  usageLimit: number | null;

  @Column({
    name: 'features_json',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  featuresJson: Record<string, unknown>;

  @Column({
    name: 'valid_until',
    type: 'timestamp with time zone',
    nullable: true,
  })
  validUntil: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
