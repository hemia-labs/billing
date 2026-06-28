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
import { PlanVersionStatus } from '../enums';
import { BillingPlanEntity } from './billing-plan.entity';
import { BillingPlanEntitlementEntity } from './billing-plan-entitlement.entity';
import { BillingPlanPriceEntity } from './billing-plan-price.entity';

@Entity('plan_versions')
@Index('IDX_plan_versions_plan_id', ['planId'])
@Index('IDX_plan_versions_plan_version_unique', ['planId', 'version'], {
  unique: true,
})
@Index('IDX_plan_versions_status', ['status'])
export class BillingPlanVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @ManyToOne(() => BillingPlanEntity, (plan) => plan.versions, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'plan_id' })
  plan: BillingPlanEntity;

  @Column({ type: 'int' })
  version: number;

  @Column({
    type: 'enum',
    enum: PlanVersionStatus,
    default: PlanVersionStatus.Draft,
  })
  status: PlanVersionStatus;

  @Column({ name: 'effective_from', type: 'timestamp with time zone', nullable: true })
  effectiveFrom: Date | null;

  @Column({ name: 'effective_until', type: 'timestamp with time zone', nullable: true })
  effectiveUntil: Date | null;

  @OneToMany(() => BillingPlanPriceEntity, (price) => price.planVersion)
  prices?: BillingPlanPriceEntity[];

  @OneToMany(() => BillingPlanEntitlementEntity, (entitlement) => entitlement.planVersion)
  entitlements?: BillingPlanEntitlementEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
