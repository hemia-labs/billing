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

@Entity('checkout_sessions')
@Index('IDX_checkout_sessions_organization_id', ['organizationId'])
@Index('IDX_checkout_sessions_product_code', ['productCode'])
@Index('IDX_checkout_sessions_plan_id', ['planId'])
@Index('IDX_checkout_sessions_provider', ['provider'])
@Index('IDX_checkout_sessions_status', ['status'])
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

  @Column({ name: 'legal_acceptance_id', length: 150 })
  legalAcceptanceId: string;

  @Column({ name: 'terms_version', length: 50 })
  termsVersion: string;

  @Column({ name: 'privacy_version', length: 50 })
  privacyVersion: string;

  @Column({ name: 'refund_policy_version', length: 50 })
  refundPolicyVersion: string;

  @Column({ name: 'accepted_at', type: 'timestamp with time zone' })
  acceptedAt: Date;

  @Column({ name: 'legal_snapshot_hash', length: 150 })
  legalSnapshotHash: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
