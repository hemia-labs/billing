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
    const payment = await this.payments.findOne({
      where: { id: dto.paymentId, organizationId: dto.organizationId },
    });

    if (!payment) throw new NotFoundException('Billing payment not found');
    if (payment.status !== PaymentStatus.Paid) {
      throw new BadRequestException('Only paid payments can be invoiced');
    }

    const activeInvoice = await this.invoices.findOne({
      where: {
        paymentId: payment.id,
        status: In([InvoiceStatus.Pending, InvoiceStatus.Issued]),
      },
    });

    if (activeInvoice) {
      throw new ConflictException('Billing invoice already exists for payment');
    }

    const totals = this.calculateIncludedTax(payment.amount);
    const invoice = await this.invoices.save(
      this.invoices.create({
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

    await this.auditInvoice(invoice, 'billing.invoice.created', null);
    return BillingInvoiceMapper.toDto(invoice);
  }

  async listInvoices(
    query: ListBillingInvoicesQueryDto,
  ): Promise<BillingInvoiceResponseDto[]> {
    const where = this.buildInvoiceWhere(query);

    const invoices = await this.invoices.find({
      where,
      order: { createdAt: 'DESC' },
    });

    return invoices.map(BillingInvoiceMapper.toDto);
  }

  async listConsoleInvoices(
    query: ListBillingInvoicesQueryDto,
  ): Promise<ConsoleBillingInvoiceResponseDto[]> {
    const invoices = await this.listInvoices(query);
    return invoices.map(this.toConsoleDto);
  }

  async getConsoleInvoice(id: string): Promise<ConsoleBillingInvoiceResponseDto> {
    return this.toConsoleDto(await this.getInvoice(id));
  }

  async issueInvoice(id: string): Promise<ConsoleBillingInvoiceResponseDto> {
    const invoice = await this.findInvoice(id);
    if (invoice.status !== InvoiceStatus.Pending) {
      throw new BadRequestException('Only pending invoices can be issued');
    }

    const previousStatus = invoice.status;

    let issued: BillingInvoiceIssuerResult;
    try {
      issued = await this.issuer.issue(invoice);
    } catch (error) {
      invoice.status = InvoiceStatus.Failed;
      invoice.metadata = {
        ...invoice.metadata,
        failureReason: this.cleanError(error),
      };
      const saved = await this.invoices.save(invoice);
      await this.auditInvoice(saved, 'billing.invoice.failed', previousStatus, {
        error: this.cleanError(error),
      });
      throw error;
    }

    invoice.cfdiUuid = issued.cfdiUuid;
    invoice.xmlUrl = issued.xmlUrl;
    invoice.pdfUrl = issued.pdfUrl;
    invoice.issuedAt = issued.issuedAt;
    invoice.status = InvoiceStatus.Issued;
    invoice.metadata = {
      ...invoice.metadata,
      provider: issued.provider,
      providerReference: issued.providerReference,
    };

    const saved = await this.invoices.save(invoice);
    await this.auditInvoice(saved, 'billing.invoice.issued', previousStatus, {
      provider: issued.provider,
      providerReference: issued.providerReference,
    });
    return this.toConsoleDto(BillingInvoiceMapper.toDto(saved));
  }

  async cancelInvoice(id: string): Promise<ConsoleBillingInvoiceResponseDto> {
    const invoice = await this.findInvoice(id);
    if (invoice.status !== InvoiceStatus.Issued) {
      throw new BadRequestException('Only issued invoices can be cancelled');
    }

    const previousStatus = invoice.status;
    const cancelled = await this.issuer.cancel(invoice);
    invoice.status = InvoiceStatus.Cancelled;
    invoice.metadata = {
      ...invoice.metadata,
      providerReference: cancelled?.providerReference,
    };

    const saved = await this.invoices.save(invoice);
    await this.auditInvoice(saved, 'billing.invoice.cancelled', previousStatus, {
      providerReference: cancelled?.providerReference,
    });
    return this.toConsoleDto(BillingInvoiceMapper.toDto(saved));
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
    ) as FindOptionsWhere<BillingInvoiceEntity>;
  }

  async getInvoice(id: string): Promise<BillingInvoiceResponseDto> {
    return BillingInvoiceMapper.toDto(await this.findInvoice(id));
  }

  async markIssued(
    id: string,
    dto: MarkBillingInvoiceIssuedDto,
  ): Promise<BillingInvoiceResponseDto> {
    const invoice = await this.findInvoice(id);
    const previousStatus = invoice.status;

    invoice.cfdiUuid = dto.cfdiUuid;
    invoice.xmlUrl = dto.xmlUrl;
    invoice.pdfUrl = dto.pdfUrl;
    invoice.issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : new Date();
    invoice.status = InvoiceStatus.Issued;

    const saved = await this.invoices.save(invoice);
    await this.auditInvoice(saved, 'billing.invoice.issued', previousStatus);
    return BillingInvoiceMapper.toDto(saved);
  }

  async markFailed(
    id: string,
    dto: MarkBillingInvoiceFailedDto,
  ): Promise<BillingInvoiceResponseDto> {
    const invoice = await this.findInvoice(id);
    const previousStatus = invoice.status;

    invoice.status = InvoiceStatus.Failed;
    invoice.metadata = {
      ...invoice.metadata,
      failureReason: dto.reason,
    };

    const saved = await this.invoices.save(invoice);
    await this.auditInvoice(saved, 'billing.invoice.failed', previousStatus);
    return BillingInvoiceMapper.toDto(saved);
  }

  async markCancelled(id: string): Promise<BillingInvoiceResponseDto> {
    const invoice = await this.findInvoice(id);
    const previousStatus = invoice.status;

    invoice.status = InvoiceStatus.Cancelled;
    const saved = await this.invoices.save(invoice);
    await this.auditInvoice(saved, 'billing.invoice.cancelled', previousStatus);
    return BillingInvoiceMapper.toDto(saved);
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
  ): Promise<void> {
    await this.audit.record({
      organizationId: invoice.organizationId,
      action,
      resourceType: 'billing_invoice',
      resourceId: invoice.id,
      metadata: {
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
    return safeInvoice;
  }

  private cleanError(error: unknown): string {
    return error instanceof Error ? error.message : 'Invoice issuer failed';
  }
}
