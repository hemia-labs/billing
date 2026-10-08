import type { BillingOperationActor } from '../../common/types/billing-operation-actor';
import type { BillingServiceAuthorization } from '../../common/types/billing-service-authorization.type';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  EntityManager,
  FindOperator,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { BillingAuditService } from '../audit';
import { BillingInvoiceEntity, BillingPaymentEntity } from '../billing-shared';
import { InvoiceStatus, PaymentStatus } from '../billing-shared';
import { BILLING_INVOICE_ISSUER_ADAPTER } from './adapters';
import type {
  BillingInvoiceIssuerAdapter,
  BillingInvoiceIssuerResult,
} from './adapters';
import {
  BillingInvoiceResponseDto,
  ConsoleBillingInvoiceResponseDto,
  CreateBillingInvoiceDto,
  ListBillingInvoicesQueryDto,
  MarkBillingInvoiceFailedDto,
  MarkBillingInvoiceIssuedDto,
} from './dtos';
import { BillingInvoiceMapper } from './mappers';

const IVA_RATE = 0.16;

@Injectable()
export class BillingInvoicesService {
  constructor(
    @InjectRepository(BillingInvoiceEntity)
    private readonly invoices: Repository<BillingInvoiceEntity>,
    @InjectRepository(BillingPaymentEntity)
    private readonly payments: Repository<BillingPaymentEntity>,
    private readonly audit: BillingAuditService,
    @Inject(BILLING_INVOICE_ISSUER_ADAPTER)
    private readonly issuer: BillingInvoiceIssuerAdapter,
  ) {}

  async createInvoice(
    dto: CreateBillingInvoiceDto,
  ): Promise<BillingInvoiceResponseDto> {
    return this.invoices.manager.transaction(async (manager) => {
      const payments = manager.getRepository(BillingPaymentEntity);
      const invoices = manager.getRepository(BillingInvoiceEntity);
      const payment = await payments.findOne({
        where: { id: dto.paymentId, organizationId: dto.organizationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!payment) throw new NotFoundException('Billing payment not found');
      if (payment.status !== PaymentStatus.Paid) {
        throw new BadRequestException('Only paid payments can be invoiced');
      }

      const activeInvoice = await invoices.findOne({
        where: {
          paymentId: payment.id,
          status: In([InvoiceStatus.Pending, InvoiceStatus.Issued]),
        },
      });

      if (activeInvoice) {
        throw new ConflictException(
          'Billing invoice already exists for payment',
        );
      }

      const totals = this.calculateIncludedTax(payment.amount);
      const invoice = await invoices.save(
        invoices.create({
          organizationId: payment.organizationId,
          paymentId: payment.id,
          payment,
          cfdiUuid: null,
          rfc: dto.rfc,
          legalName: dto.legalName,
          taxRegime: dto.taxRegime,
          cfdiUse: dto.cfdiUse,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          total: totals.total,
          currency: payment.currency,
          status: InvoiceStatus.Pending,
          xmlUrl: null,
          pdfUrl: null,
          metadata: {},
          issuedAt: null,
        }),
      );

      await this.auditInvoice(
        invoice,
        'billing.invoice.created',
        null,
        {},
        undefined,
        manager,
      );
      return BillingInvoiceMapper.toDto(invoice);
    });
  }

  async listInvoices(
    query: ListBillingInvoicesQueryDto,
    authorization: BillingServiceAuthorization,
  ): Promise<BillingInvoiceResponseDto[]> {
    const where = this.buildInvoiceWhere(query);
    const builder = this.invoices
      .createQueryBuilder('invoice')
      .leftJoin('invoice.payment', 'payment')
      .leftJoin('payment.subscription', 'subscription')
      .where(where);
    if (!authorization.policy.products.includes('*'))
      builder.andWhere('subscription.product_code IN (:...serviceProducts)', {
        serviceProducts: authorization.policy.products,
      });
    if (authorization.policy.organizationScope === 'organizations')
      builder.andWhere(
        'invoice.organization_id IN (:...serviceOrganizations)',
        {
          serviceOrganizations: authorization.policy.organizationIds,
        },
      );
    const invoices = await builder
      .orderBy('invoice.createdAt', 'DESC')
      .getMany();

    return invoices.map((item) => BillingInvoiceMapper.toDto(item));
  }

  async listConsoleInvoices(
    query: ListBillingInvoicesQueryDto,
    scope: string[] | null,
  ): Promise<ConsoleBillingInvoiceResponseDto[]> {
    const where = this.buildInvoiceWhere(query);
    if (scope !== null)
      where.organizationId = In(
        query.organization_id
          ? scope.filter((id) => id === query.organization_id)
          : scope,
      );
    const invoices = await this.invoices.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return invoices.map((invoice) =>
      this.toConsoleDto(BillingInvoiceMapper.toDto(invoice)),
    );
  }

  async getConsoleInvoice(
    id: string,
  ): Promise<ConsoleBillingInvoiceResponseDto> {
    return this.toConsoleDto(await this.getInvoice(id));
  }

  issueInvoice(id: string, actor: BillingOperationActor) {
    return this.performInvoiceOperation(id, 'issue', actor);
  }

  cancelInvoice(id: string, actor: BillingOperationActor) {
    return this.performInvoiceOperation(id, 'cancel', actor);
  }

  private async performInvoiceOperation(
    id: string,
    action: 'issue' | 'cancel',
    actor: BillingOperationActor,
  ) {
    const key = `invoice:${id}:${action}`;
    const expected =
      action === 'issue' ? InvoiceStatus.Pending : InvoiceStatus.Issued;
    const completed =
      action === 'issue' ? InvoiceStatus.Issued : InvoiceStatus.Cancelled;
    const reserved = await this.invoices.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(BillingInvoiceEntity);
        const invoice = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!invoice) throw new NotFoundException('Billing invoice not found');
        const operation = invoice.metadata.consoleOperation as
          { key: string; state: string } | undefined;
        if (
          operation?.key === key &&
          operation.state === 'completed' &&
          invoice.status === completed
        )
          return { invoice, replay: true };
        if (operation && operation.state !== 'completed')
          throw new ConflictException(
            'Invoice operation requires reconciliation before another attempt',
          );
        if (invoice.status !== expected)
          throw new ConflictException(`Invoice must be ${expected}`);
        invoice.metadata = {
          ...invoice.metadata,
          consoleOperation: {
            key,
            state: 'pending',
            actor,
            startedAt: new Date().toISOString(),
          },
        };
        await repository.save(invoice);
        await this.auditInvoice(
          invoice,
          `billing.invoice.${action}_requested`,
          expected,
          { operationKey: key, outcome: 'pending' },
          actor,
          manager,
        );
        return { invoice, replay: false };
      },
    );
    if (reserved.replay)
      return this.toConsoleDto(BillingInvoiceMapper.toDto(reserved.invoice));
    // Reservation is committed before contacting the provider. A crash or uncertain
    // response leaves it pending; never blindly reissue a fiscal operation.
    let result:
      BillingInvoiceIssuerResult | { providerReference?: string } | void;
    try {
      result =
        action === 'issue'
          ? await this.issuer.issue(reserved.invoice, key)
          : await this.issuer.cancel(reserved.invoice, key);
    } catch (error) {
      await this.invoices.manager.transaction(async (manager) => {
        const repository = manager.getRepository(BillingInvoiceEntity);
        const invoice = (await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        }))!;
        const operation = invoice.metadata.consoleOperation as {
          key: string;
          state: string;
        };
        if (operation.key === key && operation.state === 'pending') {
          invoice.metadata = {
            ...invoice.metadata,
            consoleOperation: { ...operation, state: 'unknown' },
          };
          await repository.save(invoice);
          await this.auditInvoice(
            invoice,
            `billing.invoice.${action}_uncertain`,
            expected,
            { operationKey: key, outcome: 'unknown' },
            actor,
            manager,
          );
        }
      });
      throw error;
    }
    return this.invoices.manager.transaction(async (manager) => {
      const repository = manager.getRepository(BillingInvoiceEntity);
      const invoice = (await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      }))!;
      const operation = invoice.metadata.consoleOperation as {
        key: string;
        state: string;
      };
      if (
        operation.key !== key ||
        operation.state !== 'pending' ||
        invoice.status !== expected
      )
        throw new ConflictException(
          'Invoice changed; reconcile provider result',
        );
      if (action === 'issue') {
        const issued = result as BillingInvoiceIssuerResult;
        invoice.cfdiUuid = issued.cfdiUuid;
        invoice.xmlUrl = issued.xmlUrl;
        invoice.pdfUrl = issued.pdfUrl;
        invoice.issuedAt = issued.issuedAt;
      }
      invoice.status = completed;
      invoice.metadata = {
        ...invoice.metadata,
        providerReference: result?.providerReference,
        consoleOperation: { ...operation, state: 'completed' },
      };
      await repository.save(invoice);
      await this.auditInvoice(
        invoice,
        `billing.invoice.${action === 'issue' ? 'issued' : 'cancelled'}`,
        expected,
        { operationKey: key, outcome: 'completed' },
        actor,
        manager,
      );
      return this.toConsoleDto(BillingInvoiceMapper.toDto(invoice));
    });
  }

  private buildInvoiceWhere(
    query: ListBillingInvoicesQueryDto,
  ): FindOptionsWhere<BillingInvoiceEntity> {
    const where: FindOptionsWhere<BillingInvoiceEntity> = {};
    if (query.organization_id) where.organizationId = query.organization_id;
    if (query.payment_id) where.paymentId = query.payment_id;
    if (query.status) where.status = query.status;
    where.createdAt = this.dateRange(query.created_from, query.created_to);
    where.issuedAt = this.dateRange(query.issued_from, query.issued_to);
    return Object.fromEntries(
      Object.entries(where).filter(([, value]) => value !== undefined),
    );
  }

  async getInvoice(id: string): Promise<BillingInvoiceResponseDto> {
    return BillingInvoiceMapper.toDto(await this.findInvoice(id));
  }

  markIssued(id: string, dto: MarkBillingInvoiceIssuedDto) {
    return this.reconcileInvoice(id, InvoiceStatus.Issued, (invoice) => {
      invoice.cfdiUuid = dto.cfdiUuid;
      invoice.xmlUrl = dto.xmlUrl;
      invoice.pdfUrl = dto.pdfUrl;
      invoice.issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : new Date();
    });
  }
  markFailed(id: string, dto: MarkBillingInvoiceFailedDto) {
    return this.reconcileInvoice(id, InvoiceStatus.Failed, (invoice) => {
      invoice.metadata = { ...invoice.metadata, failureReason: dto.reason };
    });
  }
  markCancelled(id: string) {
    return this.reconcileInvoice(id, InvoiceStatus.Cancelled, () => {});
  }
  private reconcileInvoice(
    id: string,
    status: InvoiceStatus,
    apply: (invoice: BillingInvoiceEntity) => void,
  ) {
    return this.invoices.manager.transaction(async (manager) => {
      const repository = manager.getRepository(BillingInvoiceEntity);
      const invoice = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invoice) throw new NotFoundException('Billing invoice not found');
      if (invoice.status === status) return BillingInvoiceMapper.toDto(invoice);
      const expected =
        status === InvoiceStatus.Cancelled
          ? InvoiceStatus.Issued
          : InvoiceStatus.Pending;
      if (invoice.status !== expected)
        throw new ConflictException(
          `Invoice must be ${expected} for reconciliation`,
        );
      const previous = invoice.status;
      const operation = invoice.metadata.consoleOperation as
        { key: string; actor: BillingOperationActor } | undefined;
      apply(invoice);
      invoice.status = status;
      if (operation)
        invoice.metadata = {
          ...invoice.metadata,
          consoleOperation: {
            ...operation,
            state: 'completed',
            reconciled: true,
          },
        };
      await repository.save(invoice);
      await this.auditInvoice(
        invoice,
        `billing.invoice.${status}`,
        previous,
        { outcome: 'reconciled', operationKey: operation?.key },
        operation?.actor,
        manager,
      );
      return BillingInvoiceMapper.toDto(invoice);
    });
  }

  private async findInvoice(id: string): Promise<BillingInvoiceEntity> {
    const invoice = await this.invoices.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Billing invoice not found');
    return invoice;
  }

  private calculateIncludedTax(total: string): {
    subtotal: string;
    taxAmount: string;
    total: string;
  } {
    const totalCents = Math.round(Number(total) * 100);
    if (!Number.isFinite(totalCents) || totalCents < 0) {
      throw new BadRequestException('Payment amount is invalid');
    }

    const subtotalCents = Math.round(totalCents / (1 + IVA_RATE));
    const taxCents = totalCents - subtotalCents;

    return {
      subtotal: this.centsToDecimal(subtotalCents),
      taxAmount: this.centsToDecimal(taxCents),
      total: this.centsToDecimal(totalCents),
    };
  }

  private centsToDecimal(cents: number): string {
    return (cents / 100).toFixed(2);
  }

  private async auditInvoice(
    invoice: BillingInvoiceEntity,
    action: string,
    previousStatus: InvoiceStatus | null,
    extraMetadata: Record<string, unknown> = {},
    actor?: BillingOperationActor,
    manager?: EntityManager,
  ): Promise<void> {
    await this.audit.record({
      manager,
      actorUserId:
        actor && /^[0-9a-f-]{36}$/i.test(actor.subject) ? actor.subject : null,
      organizationId: invoice.organizationId,
      action,
      resourceType: 'billing_invoice',
      resourceId: invoice.id,
      metadata: {
        ...(actor
          ? {
              actorIssuer: actor.issuer,
              actorSubject: actor.subject,
              actorIdentityReferenceId: actor.identityReferenceId,
              traceId: actor.traceId,
            }
          : {}),
        invoiceId: invoice.id,
        paymentId: invoice.paymentId,
        previousStatus,
        newStatus: invoice.status,
        ...extraMetadata,
      },
    });
  }

  private dateRange(
    from?: string,
    to?: string,
  ): FindOperator<Date> | undefined {
    if (from && to) return Between(new Date(from), new Date(to));
    if (from) return MoreThanOrEqual(new Date(from));
    if (to) return LessThanOrEqual(new Date(to));
    return undefined;
  }

  private toConsoleDto(
    invoice: BillingInvoiceResponseDto,
  ): ConsoleBillingInvoiceResponseDto {
    const { metadata: _metadata, ...safeInvoice } = invoice;
    void _metadata;
    return safeInvoice;
  }
}
