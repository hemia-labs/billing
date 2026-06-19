import { EntityManager } from 'typeorm';
import { BillingProvider } from '../../billing-shared';

export type BillingAuditLegalReference = {
  legalAcceptanceId: string;
  termsVersion: string;
  privacyVersion: string;
  refundPolicyVersion: string;
  acceptedAt: Date | string;
  legalSnapshotHash: string;
};

export type BillingAuditRecordInput = {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  provider?: BillingProvider | null;
  legalReference?: BillingAuditLegalReference | null;
  metadata?: Record<string, unknown>;
  manager?: EntityManager;
};
