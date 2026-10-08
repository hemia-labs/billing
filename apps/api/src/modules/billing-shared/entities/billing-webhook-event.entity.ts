import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  BillingProvider,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '../enums';

@Entity('webhook_events')
@Index('IDX_webhook_events_provider_event_id_unique', ['providerEventId'], {
  unique: true,
})
@Index('IDX_webhook_events_provider', ['provider'])
@Index('IDX_webhook_events_event_type', ['eventType'])
@Index('IDX_webhook_events_resource_id', ['resourceId'])
@Index('IDX_webhook_events_processing_status', ['processingStatus'])
@Index('ix_webhook_events_paypal_due', ['nextRetryAt', 'receivedAt', 'id'], {
  where:
    "provider = 'paypal' AND verification_status = 'verified' AND requires_manual_review = false AND processing_status IN ('pending', 'processing')",
})
export class BillingWebhookEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: BillingProvider })
  provider: BillingProvider;

  @Column({ name: 'provider_event_id', length: 180 })
  providerEventId: string;

  @Column({ name: 'event_type', length: 180 })
  eventType: string;

  @Column({ name: 'resource_id', type: 'varchar', length: 180, nullable: true })
  resourceId: string | null;

  @Column({
    name: 'transmission_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  transmissionId: string | null;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: WebhookVerificationStatus,
  })
  verificationStatus: WebhookVerificationStatus;

  @Column({
    name: 'processing_status',
    type: 'enum',
    enum: WebhookProcessingStatus,
    default: WebhookProcessingStatus.Pending,
  })
  processingStatus: WebhookProcessingStatus;

  @Column({
    name: 'payload_json',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  payloadJson: Record<string, unknown>;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'attempts', type: 'integer', default: 0 })
  attempts: number;

  @Column({
    name: 'next_retry_at',
    type: 'timestamp with time zone',
    default: () => 'CURRENT_TIMESTAMP',
  })
  nextRetryAt: Date;

  @Column({
    name: 'locked_until',
    type: 'timestamp with time zone',
    nullable: true,
  })
  lockedUntil: Date | null;

  @Column({ name: 'lease_token', type: 'uuid', nullable: true })
  leaseToken: string | null;

  @Column({ name: 'requires_manual_review', type: 'boolean', default: false })
  requiresManualReview: boolean;

  @Column({
    name: 'received_at',
    type: 'timestamp with time zone',
    default: () => 'CURRENT_TIMESTAMP',
  })
  receivedAt: Date;

  @Column({
    name: 'processed_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  processedAt: Date | null;
}
