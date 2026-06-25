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
import {
  AddonStatus,
  BillingAddonPricingModel,
  BillingAddonType,
  BillingProvider,
} from '../enums';
import { BillingProductEntity } from './billing-product.entity';
import type { AddonEntitlementEffects } from '../types';

@Entity('addons')
@Index('IDX_addons_product_id', ['productId'])
@Index('IDX_addons_product_code', ['productCode'])
@Index('IDX_addons_code', ['code'])
@Index('IDX_addons_status', ['status'])
@Index('IDX_addons_product_code_code_active_unique', ['productCode', 'code'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class BillingAddonEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => BillingProductEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product: BillingProductEntity;

  @Column({ name: 'product_code', length: 80 })
  productCode: string;

  @Column({ length: 100 })
  code: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 2 })
  unitPrice: string;

  @Column({ length: 3 })
  currency: BillingCurrency;

  @Column({ name: 'billing_interval', type: 'enum', enum: BillingInterval })
  billingInterval: BillingInterval;

  @Column({ type: 'enum', enum: BillingAddonType })
  type: BillingAddonType;

  @Column({ name: 'pricing_model', type: 'enum', enum: BillingAddonPricingModel })
  pricingModel: BillingAddonPricingModel;

  @Column({ name: 'min_quantity', type: 'int', default: 1 })
  minQuantity: number;

  @Column({ name: 'max_quantity', type: 'int', nullable: true })
  maxQuantity: number | null;

  @Column({ type: 'enum', enum: BillingProvider })
  provider: BillingProvider;

  @Column({
    name: 'provider_plan_id',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  providerPlanId: string | null;

  @Column({
    name: 'entitlement_effects',
    type: 'jsonb',
    default: () => "'{\"numeric\":{},\"features\":{}}'::jsonb",
  })
  entitlementEffects: AddonEntitlementEffects;

  @Column({
    type: 'enum',
    enum: AddonStatus,
    default: AddonStatus.Active,
  })
  status: AddonStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
