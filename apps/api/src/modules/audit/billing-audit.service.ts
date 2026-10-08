import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingAuditLogEntity } from '../billing-shared';
import { CatalogPageDto } from '../catalog/dtos';
import { BillingAuditRecordInput } from './types';
import {
  ConsoleAuditLogResponseDto,
  ListConsoleAuditLogsQueryDto,
} from './dtos';

const ALLOWED_METADATA_KEYS = new Set([
  'checkoutSessionId',
  'invoiceId',
  'actorIssuer',
  'actorSubject',
  'actorIdentityReferenceId',
  'traceId',
  'outcome',
  'operationKey',
  'subscriptionAddonId',
  'subscriptionId',
  'paymentId',
  'refundId',
  'providerRefundId',
  'paymentRefundId',
  'refundedAmount',
  'currency',
  'periodStart',
  'periodEnd',
  'cancellationJobId',
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
  'retryReason',
  'retryAttempt',
  'attemptCount',
  'requiresManualReview',
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
        acceptedAt: legal ? new Date(legal.acceptedAt) : null,
        legalSnapshotHash: legal?.legalSnapshotHash ?? null,
        metadata: {
          ...this.sanitizeMetadata(input.metadata ?? {}),
          ...(legal?.evidence ? { legalEvidence: legal.evidence } : {}),
        },
      }),
    );
  }

  async listAuditLogs(
    query: ListConsoleAuditLogsQueryDto,
    scope: string[] | null,
  ): Promise<CatalogPageDto<ConsoleAuditLogResponseDto>> {
    const builder = this.auditLogs.createQueryBuilder('audit');
    if (scope !== null)
      builder.andWhere(
        'audit.organizationId IN (:...authorizedOrganizations)',
        { authorizedOrganizations: scope },
      );
    if (query.organization_id)
      builder.andWhere('audit.organizationId = :organizationId', {
        organizationId: query.organization_id,
      });
    if (query.resource_type)
      builder.andWhere('audit.resourceType = :resourceType', {
        resourceType: query.resource_type,
      });
    if (query.resource_id)
      builder.andWhere('audit.resourceId = :resourceId', {
        resourceId: query.resource_id,
      });
    if (query.actor_user_id)
      builder.andWhere('audit.actorUserId = :actorUserId', {
        actorUserId: query.actor_user_id,
      });
    if (query.action)
      builder.andWhere('audit.action = :action', { action: query.action });
    if (query.provider)
      builder.andWhere('audit.provider = :provider', {
        provider: query.provider,
      });
    if (query.created_from)
      builder.andWhere('audit.createdAt >= :createdFrom', {
        createdFrom: query.created_from,
      });
    if (query.created_to)
      builder.andWhere('audit.createdAt <= :createdTo', {
        createdTo: query.created_to,
      });

    const [items, total] = await builder
      .orderBy('audit.createdAt', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return {
      items: items.map((item) => this.toConsoleDto(item)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getAuditLog(id: string): Promise<ConsoleAuditLogResponseDto> {
    const log = await this.auditLogs.findOne({ where: { id } });
    if (!log) throw new NotFoundException('Billing audit log not found');
    return this.toConsoleDto(log);
  }

  private sanitizeMetadata(
    metadata: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(metadata).filter(([key]) =>
        ALLOWED_METADATA_KEYS.has(key),
      ),
    );
  }

  private toConsoleDto(log: BillingAuditLogEntity): ConsoleAuditLogResponseDto {
    return {
      id: log.id,
      organizationId: log.organizationId,
      actorUserId: log.actorUserId,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      provider: log.provider,
      metadata: log.metadata,
      createdAt: log.createdAt,
    };
  }
}
