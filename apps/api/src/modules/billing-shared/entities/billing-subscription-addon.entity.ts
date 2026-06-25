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
  BillingAddonPricingModel,
  BillingProvider,
  SubscriptionAddonStatus,
} from '../enums';
import { BillingAddonEntity } from './billing-addon.entity';
import { BillingSubscriptionEntity } from './billing-subscription.entity';
import type { AddonEntitlementEffects } from '../types';

@Entity('subscription_addons')
@Index('IDX_subscription_addons_subscription_id', ['subscriptionId'])
@Index('IDX_subscription_addons_addon_id', ['addonId'])
@Index('IDX_subscription_addons_status', ['status'])
@Index('IDX_subscription_addons_provider_subscription_id', ['providerSubscriptionId'], {
  unique: true,
  where: '"provider_subscription_id" IS NOT NULL AND "deleted_at" IS NULL',
})
@Index('IDX_subscription_addons_subscription_idempotency_key', ['subscriptionId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL AND "deleted_at" IS NULL',
})
@Index(
  'IDX_subscription_addons_subscription_addon_status_unique',
  ['subscriptionId', 'addonId', 'status'],
  {
    unique: true,
    where:
      '"deleted_at" IS NULL AND "status" IN (\'pending_payment\', \'active\')',
  },
)
export class BillingSubscriptionAddonEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId: string;

  @ManyToOne(() => BillingSubscriptionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: BillingSubscriptionEntity;

  @Column({ name: 'addon_id', type: 'uuid' })
  addonId: string;

  @ManyToOne(() => BillingAddonEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'addon_id' })
  addon: BillingAddonEntity;

  @Column({ name: 'addon_code', length: 100 })
  addonCode: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({
    type: 'enum',
    enum: SubscriptionAddonStatus,
    default: SubscriptionAddonStatus.PendingPayment,
  })
  status: SubscriptionAddonStatus;

  @Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 2 })
  unitPrice: string;

  @Column({ length: 3 })
  currency: BillingCurrency;

  @Column({ name: 'billing_interval', type: 'enum', enum: BillingInterval })
  billingInterval: BillingInterval;

  @Column({ name: 'pricing_model', type: 'enum', enum: BillingAddonPricingModel })
  pricingModel: BillingAddonPricingModel;

  @Column({ name: 'entitlement_effects', type: 'jsonb' })
  entitlementEffects: AddonEntitlementEffects;

  @Column({ type: 'enum', enum: BillingProvider })
  provider: BillingProvider;

  @Column({
    name: 'provider_reference_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  providerReferenceId: string | null;

  @Column({
    name: 'provider_subscription_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  providerSubscriptionId: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 120, nullable: true })
  idempotencyKey: string | null;

  @Column({
    name: 'pending_effective_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  pendingEffectiveAt: Date | null;

  @Column({
    name: 'current_period_end',
    type: 'timestamp with time zone',
    nullable: true,
  })
  currentPeriodEnd: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
