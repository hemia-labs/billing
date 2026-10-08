import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BillingCurrency } from '../constants';
import { BillingProvider, PaymentStatus } from '../enums';
import { BillingSubscriptionEntity } from './billing-subscription.entity';
import { BillingWebhookEventEntity } from './billing-webhook-event.entity';

@Entity('payments')
@Index('IDX_payments_organization_id', ['organizationId'])
@Index('IDX_payments_subscription_id', ['subscriptionId'])
@Index('IDX_payments_provider', ['provider'])
@Index('IDX_payments_provider_payment_id', ['providerPaymentId'])
@Index('IDX_payments_provider_capture_id', ['providerCaptureId'])
@Index('IDX_payments_status', ['status'])
export class BillingPaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @ManyToOne(() => BillingSubscriptionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: BillingSubscriptionEntity | null;

  @Column({ type: 'enum', enum: BillingProvider })
  provider: BillingProvider;

  @Column({
    name: 'provider_payment_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  providerPaymentId: string | null;

  @Column({
    name: 'provider_capture_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  providerCaptureId: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({ length: 3 })
  currency: BillingCurrency;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.Pending,
  })
  status: PaymentStatus;

  @Column({ name: 'paid_at', type: 'timestamp with time zone', nullable: true })
  paidAt: Date | null;

  @Column({
    name: 'period_start',
    type: 'timestamp with time zone',
    nullable: true,
  })
  periodStart: Date | null;

  @Column({
    name: 'period_end',
    type: 'timestamp with time zone',
    nullable: true,
  })
  periodEnd: Date | null;

  @Column({ name: 'raw_event_id', type: 'uuid', nullable: true })
  rawEventId: string | null;

  @ManyToOne(() => BillingWebhookEventEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'raw_event_id' })
  rawEvent: BillingWebhookEventEntity | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
