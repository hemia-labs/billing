import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BillingFeatureDefinitionEntity } from './billing-feature-definition.entity';
import { BillingPlanVersionEntity } from './billing-plan-version.entity';

@Entity('plan_entitlements')
@Index('IDX_plan_entitlements_plan_version_id', ['planVersionId'])
@Index('IDX_plan_entitlements_feature_id', ['featureId'])
@Index(
  'IDX_plan_entitlements_version_feature_unique',
  ['planVersionId', 'featureId'],
  {
    unique: true,
  },
)
export class BillingPlanEntitlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_version_id', type: 'uuid' })
  planVersionId: string;

  @ManyToOne(
    () => BillingPlanVersionEntity,
    (version) => version.entitlements,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'plan_version_id' })
  planVersion: BillingPlanVersionEntity;

  @Column({ name: 'feature_id', type: 'uuid' })
  featureId: string;

  @ManyToOne(() => BillingFeatureDefinitionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'feature_id' })
  feature: BillingFeatureDefinitionEntity;

  @Column({ name: 'value_json', type: 'jsonb' })
  valueJson: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
