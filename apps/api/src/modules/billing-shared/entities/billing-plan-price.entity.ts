import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BillingCurrency } from '../constants';
import { PlanPriceBillingInterval, PlanPriceStatus } from '../enums';
import { BillingPlanVersionEntity } from './billing-plan-version.entity';
import { BillingProviderPriceEntity } from './billing-provider-price.entity';

@Entity('plan_prices')
@Index('IDX_plan_prices_plan_version_id', ['planVersionId'])
@Index('IDX_plan_prices_plan_version_code_unique', ['planVersionId', 'code'], {
  unique: true,
})
@Index('IDX_plan_prices_status', ['status'])
export class BillingPlanPriceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_version_id', type: 'uuid' })
  planVersionId: string;

  @ManyToOne(() => BillingPlanVersionEntity, (version) => version.prices, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'plan_version_id' })
  planVersion: BillingPlanVersionEntity;

  @Column({ length: 100 })
  code: string;

  @Column({
    name: 'billing_interval',
    type: 'enum',
    enum: PlanPriceBillingInterval,
  })
  billingInterval: PlanPriceBillingInterval;

  @Column({ name: 'billing_interval_count', type: 'int', default: 1 })
  billingIntervalCount: number;

  @Column({ length: 3 })
  currency: BillingCurrency;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({
    type: 'enum',
    enum: PlanPriceStatus,
    default: PlanPriceStatus.Active,
  })
  status: PlanPriceStatus;

  @OneToMany(
    () => BillingProviderPriceEntity,
    (providerPrice) => providerPrice.planPrice,
  )
  providerPrices?: BillingProviderPriceEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
