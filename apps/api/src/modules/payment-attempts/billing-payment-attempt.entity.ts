import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { BillingProvider } from '../billing-shared';
import type {
  CreatePaymentAttemptDto,
  PaymentAttemptResponse,
} from './payment-attempt.dto';

@Entity('payment_attempts')
@Index('IDX_payment_attempts_pending', ['updatedAt'], {
  where: "status='pending'",
})
export class BillingPaymentAttemptEntity {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'product_code', length: 80 }) productCode: string;
  @Column({ name: 'created_by_issuer', length: 512 }) createdByIssuer: string;
  @Column({ name: 'created_by_client_id', length: 200 })
  createdByClientId: string;
  @Column({ name: 'request_hash', length: 64 }) requestHash: string;
  @Column({ name: 'request_payload', type: 'jsonb' })
  requestPayload: CreatePaymentAttemptDto & { provider?: BillingProvider };
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status:
    'pending' | 'ready' | 'rejected';
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  receipt: Partial<PaymentAttemptResponse>;
  @Column({ name: 'lease_token', type: 'uuid', nullable: true }) leaseToken:
    string | null;
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
