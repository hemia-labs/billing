import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  FeatureAggregationStrategy,
  FeatureDefinitionStatus,
  FeatureValueType,
} from '../enums';
import { BillingProductEntity } from './billing-product.entity';

@Entity('feature_definitions')
@Index('IDX_feature_definitions_product_id', ['productId'])
@Index('IDX_feature_definitions_product_code_unique', ['productId', 'code'], {
  unique: true,
})
export class BillingFeatureDefinitionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => BillingProductEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product: BillingProductEntity;

  @Column({ length: 120 })
  code: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'value_type', type: 'enum', enum: FeatureValueType })
  valueType: FeatureValueType;

  @Column({ type: 'varchar', length: 50, nullable: true })
  unit: string | null;

  @Column({
    name: 'aggregation_strategy',
    type: 'enum',
    enum: FeatureAggregationStrategy,
    default: FeatureAggregationStrategy.Replace,
  })
  aggregationStrategy: FeatureAggregationStrategy;

  @Column({ name: 'is_metered', type: 'boolean', default: false })
  isMetered: boolean;

  @Column({
    type: 'enum',
    enum: FeatureDefinitionStatus,
    default: FeatureDefinitionStatus.Active,
  })
  status: FeatureDefinitionStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
