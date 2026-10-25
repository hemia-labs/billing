import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BillingTenantStatus } from '../enums';

@Entity('tenants')
@Index('IDX_tenants_organization_id_unique', ['organizationId'], {
  unique: true,
})
@Index('IDX_tenants_status', ['status'])
export class BillingTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ length: 80 })
  code: string;

  @Column({ length: 120 })
  name: string;

  @Column({
    type: 'enum',
    enum: BillingTenantStatus,
    default: BillingTenantStatus.Active,
  })
  status: BillingTenantStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  configuration: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
