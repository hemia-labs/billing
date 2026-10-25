import { webhookOrganizationSql } from '../webhooks/webhook-organization.sql';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  MoreThanOrEqual,
  Not,
  Repository,
  SelectQueryBuilder,
  ObjectLiteral,
} from 'typeorm';
import {
  BillingCheckoutSessionEntity,
  BillingInvoiceEntity,
  BillingLicenseEntity,
  BillingSubscriptionEntity,
  BillingWebhookEventEntity,
  BillingAuditLogEntity,
  SubscriptionStatus,
  WebhookProcessingStatus,
} from '../billing-shared';
import {
  BillingCheckoutSessionStatus,
  InvoiceStatus,
  LicenseStatus,
} from '../billing-shared';
import { CatalogPageDto } from '../catalog/dtos';
import {
  BillingDashboardSummaryDto,
  ConsoleCheckoutResponseDto,
  ConsoleLicenseResponseDto,
  ConsoleSubscriptionResponseDto,
  ListConsoleCheckoutsQueryDto,
  ListConsoleLicensesQueryDto,
  ListConsoleSubscriptionsQueryDto,
} from './dtos';
import { BillingOperationsMapper } from './operations.mapper';

@Injectable()
export class BillingOperationsService {
  constructor(
    @InjectRepository(BillingSubscriptionEntity)
    private readonly subscriptions: Repository<BillingSubscriptionEntity>,
    @InjectRepository(BillingCheckoutSessionEntity)
    private readonly checkouts: Repository<BillingCheckoutSessionEntity>,
    @InjectRepository(BillingLicenseEntity)
    private readonly licenses: Repository<BillingLicenseEntity>,
    @InjectRepository(BillingInvoiceEntity)
    private readonly invoices: Repository<BillingInvoiceEntity>,
    @InjectRepository(BillingWebhookEventEntity)
    private readonly webhooks: Repository<BillingWebhookEventEntity>,
    @InjectRepository(BillingAuditLogEntity)
    private readonly auditLogs: Repository<BillingAuditLogEntity>,
  ) {}

  async listSubscriptions(
    query: ListConsoleSubscriptionsQueryDto,
    scope: string[] | null,
  ): Promise<CatalogPageDto<ConsoleSubscriptionResponseDto>> {
    this.validateRange(query);
    const builder = this.subscriptions.createQueryBuilder('subscription');
    if (scope !== null)
      builder.andWhere(
        'subscription.organizationId IN (:...authorizedOrganizations)',
        { authorizedOrganizations: scope },
      );
    if (query.organization_id)
      builder.andWhere('subscription.organizationId = :organizationId', {
        organizationId: query.organization_id,
      });
    if (query.product_code)
      builder.andWhere('subscription.productCode = :productCode', {
        productCode: query.product_code,
      });
    if (query.plan_code)
      builder.andWhere('subscription.planCode = :planCode', {
        planCode: query.plan_code,
      });
    if (query.provider)
      builder.andWhere('subscription.provider = :provider', {
        provider: query.provider,
      });
    if (query.status)
      builder.andWhere('subscription.status = :status', {
        status: query.status,
      });
    this.range(builder, 'subscription', query);
    const [items, total] = await builder
      .orderBy('subscription.createdAt', 'DESC')
      .addOrderBy('subscription.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return this.page(
      items.map((item) => BillingOperationsMapper.subscription(item)),
      total,
      query,
    );
  }

  async getSubscription(id: string): Promise<ConsoleSubscriptionResponseDto> {
    const subscription = await this.subscriptions.findOne({ where: { id } });
    if (!subscription)
      throw new NotFoundException('Billing subscription not found');
    return BillingOperationsMapper.subscription(subscription);
  }

  async listCheckouts(
    query: ListConsoleCheckoutsQueryDto,
    scope: string[] | null,
  ): Promise<CatalogPageDto<ConsoleCheckoutResponseDto>> {
    this.validateRange(query);
    const builder = this.checkouts
      .createQueryBuilder('checkout')
      .leftJoinAndSelect('checkout.plan', 'plan');
    if (scope !== null)
      builder.andWhere(
        'checkout.organizationId IN (:...authorizedOrganizations)',
        { authorizedOrganizations: scope },
      );
    if (query.organization_id)
      builder.andWhere('checkout.organizationId = :organizationId', {
        organizationId: query.organization_id,
      });
    if (query.subscription_id)
      builder.andWhere(
        "checkout.metadata ->> 'subscriptionId' = :subscriptionId",
        { subscriptionId: query.subscription_id },
      );
    if (query.provider)
      builder.andWhere('checkout.provider = :provider', {
        provider: query.provider,
      });
    if (query.status)
      builder.andWhere('checkout.status = :status', { status: query.status });
    this.range(builder, 'checkout', query);
    const [items, total] = await builder
      .orderBy('checkout.createdAt', 'DESC')
      .addOrderBy('checkout.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return this.page(
      items.map((item) => BillingOperationsMapper.checkout(item)),
      total,
      query,
    );
  }

  async getCheckout(id: string): Promise<ConsoleCheckoutResponseDto> {
    const checkout = await this.checkouts.findOne({
      where: { id },
      relations: { plan: true },
    });
    if (!checkout)
      throw new NotFoundException('Billing checkout session not found');
    return BillingOperationsMapper.checkout(checkout);
  }

  async listLicenses(
    query: ListConsoleLicensesQueryDto,
    scope: string[] | null,
  ): Promise<CatalogPageDto<ConsoleLicenseResponseDto>> {
    const where: Record<string, unknown> = {};
    if (scope !== null)
      where.organizationId = In(
        query.organization_id
          ? scope.filter((id) => id === query.organization_id)
          : scope,
      );
    else if (query.organization_id)
      where.organizationId = query.organization_id;
    if (query.product_code) where.productCode = query.product_code;
    if (query.status) where.status = query.status;
    const [items, total] = await this.licenses.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return this.page(
      items.map((item) => BillingOperationsMapper.license(item)),
      total,
      query,
    );
  }

  async getLicense(id: string): Promise<ConsoleLicenseResponseDto> {
    const license = await this.licenses.findOne({ where: { id } });
    if (!license) throw new NotFoundException('Billing license not found');
    return BillingOperationsMapper.license(license);
  }

  async dashboard(scope: string[] | null): Promise<BillingDashboardSummaryDto> {
    const where = scope === null ? {} : { organizationId: In(scope) };
    const subscriptions = {} as Record<SubscriptionStatus, number>;
    for (const status of Object.values(SubscriptionStatus))
      subscriptions[status] = await this.subscriptions.count({
        where: { ...where, status },
      });
    return {
      subscriptions,
      pendingCheckouts: await this.checkouts.count({
        where: { ...where, status: BillingCheckoutSessionStatus.Created },
      }),
      failedCheckouts: await this.checkouts.count({
        where: { ...where, status: BillingCheckoutSessionStatus.Failed },
      }),
      inactiveLicenses: await this.licenses.count({
        where: { ...where, status: Not(LicenseStatus.Active) },
      }),
      pendingInvoices: await this.invoices.count({
        where: { ...where, status: InvoiceStatus.Pending },
      }),
      failedInvoices: await this.invoices.count({
        where: { ...where, status: InvoiceStatus.Failed },
      }),
      // Webhooks have no trusted organization ownership in the current storage model.
      failedWebhooks:
        scope === null
          ? await this.webhooks.count({
              where: { processingStatus: WebhookProcessingStatus.Failed },
            })
          : await this.webhooks
              .createQueryBuilder('webhook')
              .where('webhook.processingStatus = :status', {
                status: WebhookProcessingStatus.Failed,
              })
              .andWhere(
                `${webhookOrganizationSql('webhook')} IN (:...authorizedOrganizations)`,
                { authorizedOrganizations: scope },
              )
              .getCount(),
      webhookRetries24h: await this.auditLogs.count({
        where: {
          ...where,
          action: 'billing.webhook.manual_retry',
          createdAt: MoreThanOrEqual(new Date(Date.now() - 86400000)),
        },
      }),
    };
  }

  private range<T extends ObjectLiteral>(
    builder: SelectQueryBuilder<T>,
    alias: string,
    query: { created_from?: Date; created_to?: Date },
  ): void {
    if (query.created_from)
      builder.andWhere(`${alias}.createdAt >= :createdFrom`, {
        createdFrom: query.created_from,
      });
    if (query.created_to)
      builder.andWhere(`${alias}.createdAt <= :createdTo`, {
        createdTo: query.created_to,
      });
  }

  private validateRange(query: {
    created_from?: Date;
    created_to?: Date;
  }): void {
    if (
      query.created_from &&
      query.created_to &&
      query.created_from > query.created_to
    )
      throw new BadRequestException('created_from must be before created_to');
  }

  private page<T>(
    items: T[],
    total: number,
    query: { page: number; limit: number },
  ): CatalogPageDto<T> {
    return { items, total, page: query.page, limit: query.limit };
  }
}
