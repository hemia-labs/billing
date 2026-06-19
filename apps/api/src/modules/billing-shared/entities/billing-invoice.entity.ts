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
import type { BillingCurrency } from '../constants';
import { InvoiceStatus } from '../enums';
import { BillingPaymentEntity } from './billing-payment.entity';

@Entity('billing_invoices')
@Index('IDX_billing_invoices_organization_id', ['organizationId'])
@Index('IDX_billing_invoices_payment_id', ['paymentId'])
@Index('IDX_billing_invoices_cfdi_uuid', ['cfdiUuid'])
@Index('IDX_billing_invoices_status', ['status'])
export class BillingInvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  @ManyToOne(() => BillingPaymentEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_id' })
  payment: BillingPaymentEntity;

  @Column({ name: 'cfdi_uuid', length: 120, nullable: true })
  cfdiUuid: string | null;

  @Column({ length: 13 })
  rfc: string;

  @Column({ name: 'legal_name', length: 255 })
  legalName: string;

  @Column({ name: 'tax_regime', length: 20 })
  taxRegime: string;

  @Column({ name: 'cfdi_use', length: 20 })
  cfdiUse: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal: string;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 12, scale: 2 })
  taxAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: string;

  @Column({ length: 3 })
  currency: BillingCurrency;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    default: InvoiceStatus.Pending,
  })
  status: InvoiceStatus;

  @Column({ name: 'xml_url', type: 'text', nullable: true })
  xmlUrl: string | null;

  @Column({ name: 'pdf_url', type: 'text', nullable: true })
  pdfUrl: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @Column({
    name: 'issued_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  issuedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
