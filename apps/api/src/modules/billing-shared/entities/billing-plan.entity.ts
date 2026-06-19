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
import { BillingInterval } from '../constants';
import type { BillingCurrency } from '../constants';
import { BillingPlanStatus, BillingProvider } from '../enums';
import { BillingProductEntity } from './billing-product.entity';

@Entity('billing_plans')
@Index('IDX_billing_plans_product_id', ['productId'])
@Index('IDX_billing_plans_code', ['code'])
@Index('IDX_billing_plans_provider', ['provider'])
@Index('IDX_billing_plans_provider_plan_id', ['providerPlanId'])
@Index('IDX_billing_plans_status', ['status'])
export class BillingPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => BillingProductEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product: BillingProductEntity;

  @Column({ length: 100 })
  code: string;

  @Column({ type: 'enum', enum: BillingProvider })
  provider: BillingProvider;

  @Column({ name: 'provider_plan_id', length: 150, nullable: true })
  providerPlanId: string | null;

  @Column({ length: 120 })
  name: string;

  @Column({ name: 'billing_interval', type: 'enum', enum: BillingInterval })
  billingInterval: BillingInterval;

  @Column({ length: 3 })
  currency: BillingCurrency;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({ name: 'seats_included', type: 'int', default: 0 })
  seatsIncluded: number;

  @Column({
    name: 'features_json',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  featuresJson: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: BillingPlanStatus,
    default: BillingPlanStatus.Active,
  })
  status: BillingPlanStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
