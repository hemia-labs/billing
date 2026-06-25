import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BillingCustomerStatus, BillingProvider } from '../enums';

@Entity('customers')
@Index('IDX_customers_organization_id', ['organizationId'])
@Index('IDX_customers_provider', ['provider'])
@Index('IDX_customers_provider_payer_id', ['providerPayerId'])
export class BillingCustomerEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'enum', enum: BillingProvider })
  provider: BillingProvider;

  @Column({
    name: 'provider_payer_id',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  providerPayerId: string | null;

  @Column({ name: 'payer_email', type: 'varchar', length: 255, nullable: true })
  payerEmail: string | null;

  @Column({
    name: 'billing_email',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  billingEmail: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  country: string | null;

  @Column({
    type: 'enum',
    enum: BillingCustomerStatus,
    default: BillingCustomerStatus.Active,
  })
  status: BillingCustomerStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt?: Date | null;
}
