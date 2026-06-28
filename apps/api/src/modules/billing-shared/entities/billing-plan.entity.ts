import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BillingPlanStatus } from '../enums';
import { BillingPlanVersionEntity } from './billing-plan-version.entity';
import { BillingProductEntity } from './billing-product.entity';

@Entity('plans')
@Index('IDX_plans_product_id', ['productId'])
@Index('IDX_plans_code', ['code'])
@Index('IDX_plans_product_code_unique', ['productId', 'code'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Index('IDX_plans_status', ['status'])
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

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

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

  @OneToMany(() => BillingPlanVersionEntity, (version) => version.plan)
  versions?: BillingPlanVersionEntity[];
}
