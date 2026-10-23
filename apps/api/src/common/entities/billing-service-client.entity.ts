import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { BillingServiceClientPolicy } from '../types/billing-service-policy';

@Entity('billing_service_clients')
@Index('IDX_billing_service_clients_client_id', ['clientId'], { unique: true })
export class BillingServiceClientEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', length: 120 })
  clientId: string;

  @Column({ type: 'jsonb' })
  policy: BillingServiceClientPolicy;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
