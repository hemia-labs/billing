import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingAuditLogEntity } from '../billing-shared';
import { BillingAuditRecordInput } from './types';

const ALLOWED_METADATA_KEYS = new Set([
  'checkoutSessionId',
  'invoiceId',
  'subscriptionAddonId',
  'subscriptionId',
  'paymentId',
  'licenseId',
  'addonCode',
  'quantity',
  'webhookEventId',
  'providerEventId',
  'eventType',
  'previousStatus',
  'newStatus',
  'targetPlanCode',
  'providerSubscriptionId',
  'providerStatus',
]);

@Injectable()
export class BillingAuditService {
  constructor(
    @InjectRepository(BillingAuditLogEntity)
    private readonly auditLogs: Repository<BillingAuditLogEntity>,
  ) {}

  async record(input: BillingAuditRecordInput): Promise<BillingAuditLogEntity> {
    const repository = input.manager
      ? input.manager.getRepository(BillingAuditLogEntity)
      : this.auditLogs;
    const legal = input.legalReference ?? null;

    return repository.save(
      repository.create({
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        provider: input.provider ?? null,
        legalAcceptanceId: legal?.legalAcceptanceId ?? null,
        termsVersion: legal?.termsVersion ?? null,
        privacyVersion: legal?.privacyVersion ?? null,
        refundPolicyVersion: legal?.refundPolicyVersion ?? null,
        acceptedAt: legal ? new Date(legal.acceptedAt) : null,
        legalSnapshotHash: legal?.legalSnapshotHash ?? null,
        metadata: this.sanitizeMetadata(input.metadata ?? {}),
      }),
    );
  }

  private sanitizeMetadata(
    metadata: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(metadata).filter(([key]) => ALLOWED_METADATA_KEYS.has(key)),
    );
  }
}
