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
import { BillingProvider, SubscriptionStatus } from '../enums';
import { BillingCustomerEntity } from './billing-customer.entity';
import { BillingPlanEntity } from './billing-plan.entity';

@Entity('billing_subscriptions')
@Index('IDX_billing_subscriptions_organization_id', ['organizationId'])
@Index('IDX_billing_subscriptions_product_code', ['productCode'])
@Index('IDX_billing_subscriptions_plan_code', ['planCode'])
@Index('IDX_billing_subscriptions_provider', ['provider'])
@Index('IDX_billing_subscriptions_status', ['status'])
@Index(
  'IDX_billing_subscriptions_provider_subscription_id_unique',
  ['providerSubscriptionId'],
  {
    unique: true,
    where:
      '"provider_subscription_id" IS NOT NULL AND "deleted_at" IS NULL',
  },
)
export class BillingSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'billing_customer_id', type: 'uuid' })
  billingCustomerId: string;

  @ManyToOne(() => BillingCustomerEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'billing_customer_id' })
  billingCustomer: BillingCustomerEntity;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @ManyToOne(() => BillingPlanEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_id' })
  plan: BillingPlanEntity;

  @Column({ name: 'product_code', length: 80 })
  productCode: string;

  @Column({ name: 'plan_code', length: 100 })
  planCode: string;

  @Column({ type: 'enum', enum: BillingProvider })
  provider: BillingProvider;

  @Column({ name: 'provider_subscription_id', length: 150, nullable: true })
  providerSubscriptionId: string | null;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.Pending,
  })
  status: SubscriptionStatus;

  @Column({
    name: 'current_period_start',
    type: 'timestamp with time zone',
    nullable: true,
  })
  currentPeriodStart: Date | null;

  @Column({
    name: 'current_period_end',
    type: 'timestamp with time zone',
    nullable: true,
  })
  currentPeriodEnd: Date | null;

  @Column({
    name: 'next_billing_time',
    type: 'timestamp with time zone',
    nullable: true,
  })
  nextBillingTime: Date | null;

  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd: boolean;

  @Column({
    name: 'grace_until',
    type: 'timestamp with time zone',
    nullable: true,
  })
  graceUntil: Date | null;

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
