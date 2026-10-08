import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BillingProvider } from '../enums';
import { BillingPaymentEntity } from './billing-payment.entity';
import { BillingWebhookEventEntity } from './billing-webhook-event.entity';

@Entity('payment_refunds')
@Index(
  'UQ_payment_refunds_provider_refund_id',
  ['provider', 'providerRefundId'],
  {
    unique: true,
  },
)
@Index('IDX_payment_refunds_payment_id', ['paymentId'])
export class BillingPaymentRefundEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  provider: BillingProvider;

  @Column({ name: 'provider_refund_id', length: 180 })
  providerRefundId: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  @ManyToOne(() => BillingPaymentEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_id' })
  payment: BillingPaymentEntity;

  @Column({ name: 'webhook_event_id', type: 'uuid' })
  webhookEventId: string;

  @ManyToOne(() => BillingWebhookEventEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'webhook_event_id' })
  webhookEvent: BillingWebhookEventEntity;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({ length: 3 })
  currency: string;

  @Column({ name: 'refunded_at', type: 'timestamptz' })
  refundedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
