import {
  Column,
  Check,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BillingProductEntity } from './billing-product.entity';

export type PaypalConnectionEnvironment = 'sandbox' | 'live';

@Entity('paypal_connections')
@Index('IDX_paypal_connections_product_current', ['productId'], {
  unique: true,
  where: '"is_current" = true',
})
@Index('IDX_paypal_connections_product_draft', ['productId'], {
  unique: true,
  where: '"is_draft" = true',
})
@Check(
  'CHK_paypal_connections_draft_inactive',
  'NOT "is_draft" OR (NOT "is_current" AND NOT "enabled")',
)
export class BillingPaypalConnectionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'product_id', type: 'uuid' }) productId: string;
  @ManyToOne(() => BillingProductEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product: BillingProductEntity;
  @Column({ length: 120 }) name: string;
  @Column({ type: 'varchar', length: 7 })
  environment: PaypalConnectionEnvironment;
  @Column({ name: 'client_id', length: 255 }) clientId: string;
  @Column({ name: 'client_secret_encrypted', type: 'text', select: false })
  clientSecretEncrypted: string;
  @Column({ name: 'webhook_id', length: 255 }) webhookId: string;
  @Column({ type: 'boolean', default: false }) enabled: boolean;
  @Column({ name: 'is_draft', type: 'boolean', default: false })
  isDraft: boolean;
  @Column({ name: 'is_current', type: 'boolean', default: true })
  isCurrent: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
