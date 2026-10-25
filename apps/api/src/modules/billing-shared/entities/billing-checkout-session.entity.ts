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
import { BillingCheckoutSessionStatus, BillingProvider } from '../enums';
import { BillingPlanEntity } from './billing-plan.entity';
import { BillingPlanPriceEntity } from './billing-plan-price.entity';
import { BillingProviderPriceEntity } from './billing-provider-price.entity';

@Entity('checkout_sessions')
@Index('IDX_checkout_sessions_organization_id', ['organizationId'])
@Index('IDX_checkout_sessions_product_code', ['productCode'])
@Index('IDX_checkout_sessions_plan_id', ['planId'])
@Index('IDX_checkout_sessions_provider', ['provider'])
@Index('IDX_checkout_sessions_status', ['status'])
// Expression index is maintained by the checkout idempotency migration.
@Index('UQ_checkout_sessions_service_idempotency', { synchronize: false })
export class BillingCheckoutSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'product_code', length: 80 })
  productCode: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @ManyToOne(() => BillingPlanEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_id' })
  plan: BillingPlanEntity;

  @Column({ name: 'plan_price_id', type: 'uuid', nullable: true })
  planPriceId: string | null;

  @ManyToOne(() => BillingPlanPriceEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_price_id' })
  planPrice: BillingPlanPriceEntity | null;

  @Column({ name: 'provider_price_id', type: 'uuid', nullable: true })
  providerPriceId: string | null;

  @ManyToOne(() => BillingProviderPriceEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'provider_price_id' })
  providerPrice: BillingProviderPriceEntity | null;

  @Column({
    name: 'plan_price_code',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  planPriceCode: string | null;

  @Column({ type: 'enum', enum: BillingProvider })
  provider: BillingProvider;

  @Column({ name: 'provider_checkout_url', type: 'text', nullable: true })
  providerCheckoutUrl: string | null;

  @Column({
    type: 'enum',
    enum: BillingCheckoutSessionStatus,
    default: BillingCheckoutSessionStatus.Created,
  })
  status: BillingCheckoutSessionStatus;

  @Column({ name: 'success_url', type: 'text' })
  successUrl: string;

  @Column({ name: 'cancel_url', type: 'text' })
  cancelUrl: string;

  @Column({
    name: 'legal_acceptance_id',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  legalAcceptanceId: string | null;

  @Column({
    name: 'accepted_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  acceptedAt: Date | null;

  @Column({
    name: 'legal_snapshot_hash',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  legalSnapshotHash: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
