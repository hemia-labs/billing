import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import {
  BillingCheckoutSessionEntity,
  BillingInvoiceEntity,
  BillingLicenseEntity,
  BillingSubscriptionEntity,
  BillingWebhookEventEntity,
  BillingAuditLogEntity,
  SubscriptionStatus,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
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
  ): Promise<CatalogPageDto<ConsoleSubscriptionResponseDto>> {
    this.validateRange(query);
    const builder = this.subscriptions.createQueryBuilder('subscription');
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
      items.map(BillingOperationsMapper.subscription),
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
  ): Promise<CatalogPageDto<ConsoleCheckoutResponseDto>> {
    this.validateRange(query);
    const builder = this.checkouts
      .createQueryBuilder('checkout')
      .leftJoinAndSelect('checkout.plan', 'plan');
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
    return this.page(items.map(BillingOperationsMapper.checkout), total, query);
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
  ): Promise<CatalogPageDto<ConsoleLicenseResponseDto>> {
    const where: Record<string, unknown> = {};
    if (query.organization_id) where.organizationId = query.organization_id;
    if (query.product_code) where.productCode = query.product_code;
    if (query.status) where.status = query.status;
    const [items, total] = await this.licenses.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return this.page(items.map(BillingOperationsMapper.license), total, query);
  }

  async getLicense(id: string): Promise<ConsoleLicenseResponseDto> {
    const license = await this.licenses.findOne({ where: { id } });
    if (!license) throw new NotFoundException('Billing license not found');
    return BillingOperationsMapper.license(license);
  }

  async dashboard(): Promise<BillingDashboardSummaryDto> {
    // ponytail: dummy temporal; volver a consultas reales cuando auth/DB del dashboard esté listo.
    return {
      subscriptions: {
        [SubscriptionStatus.Pending]: 3,
        [SubscriptionStatus.Active]: 12,
        [SubscriptionStatus.PastDue]: 2,
        [SubscriptionStatus.Suspended]: 0,
        [SubscriptionStatus.Cancelled]: 1,
        [SubscriptionStatus.Expired]: 0,
      },
      pendingCheckouts: 4,
      failedCheckouts: 1,
      inactiveLicenses: 3,
      pendingInvoices: 5,
      failedInvoices: 2,
      failedWebhooks: 1,
      webhookRetries24h: 7,
    };
  }

  private range(
    builder: any,
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
