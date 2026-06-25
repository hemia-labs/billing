import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BillingProvider } from '../enums';

@Entity('audit_logs')
@Index('IDX_audit_logs_organization_id', ['organizationId'])
@Index('IDX_audit_logs_actor_user_id', ['actorUserId'])
@Index('IDX_audit_logs_resource', ['resourceType', 'resourceId'])
@Index('IDX_audit_logs_provider', ['provider'])
@Index('IDX_audit_logs_legal_acceptance_id', ['legalAcceptanceId'])
export class BillingAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ length: 120 })
  action: string;

  @Column({ name: 'resource_type', length: 120 })
  resourceType: string;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId: string | null;

  @Column({ type: 'enum', enum: BillingProvider, nullable: true })
  provider: BillingProvider | null;

  @Column({
    name: 'legal_acceptance_id',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  legalAcceptanceId: string | null;

  @Column({
    name: 'terms_version',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  termsVersion: string | null;

  @Column({
    name: 'privacy_version',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  privacyVersion: string | null;

  @Column({
    name: 'refund_policy_version',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  refundPolicyVersion: string | null;

  @Column({
    name: 'accepted_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  acceptedAt: Date | null;

  @Column({
    name: 'legal_snapshot_hash',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  legalSnapshotHash: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
