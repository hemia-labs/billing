import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BillingAuditService } from 'src/modules/audit';
import { BillingInvoiceEntity, BillingPaymentEntity } from 'src/modules/billing-shared';
import { BillingProvider, InvoiceStatus, PaymentStatus } from 'src/modules/billing-shared';
import { BillingInvoicesService } from 'src/modules/invoices/billing-invoices.service';

const createRepositoryMock = () => ({
  create: jest.fn((entity) => entity),
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(async (entity) => ({ id: entity.id ?? 'invoice-id', ...entity })),
});

const payment = {
  id: 'payment-id',
  organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
  provider: BillingProvider.Paypal,
  amount: '116.00',
  currency: 'MXN',
  status: PaymentStatus.Paid,
};

const createDto = {
  organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
  paymentId: 'payment-id',
  rfc: 'XAXX010101000',
  legalName: 'Clinica Hemia SA de CV',
  taxRegime: '601',
  cfdiUse: 'G03',
};

describe('BillingInvoicesService', () => {
  let invoices: ReturnType<typeof createRepositoryMock>;
  let payments: ReturnType<typeof createRepositoryMock>;
  let audit: { record: jest.Mock };
  let service: BillingInvoicesService;

  beforeEach(() => {
    invoices = createRepositoryMock();
    payments = createRepositoryMock();
    audit = { record: jest.fn().mockResolvedValue({}) };
    service = new BillingInvoicesService(
      invoices as never,
      payments as never,
      audit as unknown as BillingAuditService,
    );
  });

  it('creates pending invoice from paid payment and calculates included IVA', async () => {
    payments.findOne.mockResolvedValue(payment);
    invoices.findOne.mockResolvedValue(null);

    const result = await service.createInvoice(createDto);

    expect(invoices.save).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: payment.organizationId,
        paymentId: payment.id,
        subtotal: '100.00',
        taxAmount: '16.00',
        total: '116.00',
        currency: 'MXN',
        status: InvoiceStatus.Pending,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.invoice.created',
        resourceType: 'billing_invoice',
        metadata: {
          invoiceId: 'invoice-id',
          paymentId: 'payment-id',
          previousStatus: null,
          newStatus: InvoiceStatus.Pending,
        },
      }),
    );
    expect(result.status).toBe(InvoiceStatus.Pending);
  });

  it('rejects missing payment', async () => {
    payments.findOne.mockResolvedValue(null);

    await expect(service.createInvoice(createDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects non paid payment', async () => {
    payments.findOne.mockResolvedValue({
      ...payment,
      status: PaymentStatus.Failed,
    });

    await expect(service.createInvoice(createDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects duplicate active invoice for payment', async () => {
    payments.findOne.mockResolvedValue(payment);
    invoices.findOne.mockResolvedValue({
      id: 'existing-invoice-id',
      status: InvoiceStatus.Pending,
    });

    await expect(service.createInvoice(createDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('marks invoice as issued with CFDI assets', async () => {
    invoices.findOne.mockResolvedValue({
      id: 'invoice-id',
      organizationId: payment.organizationId,
      paymentId: payment.id,
      status: InvoiceStatus.Pending,
      metadata: {},
    });

    const result = await service.markIssued('invoice-id', {
      cfdiUuid: 'cfdi-uuid',
      xmlUrl: 'https://files.test/cfdi.xml',
      pdfUrl: 'https://files.test/cfdi.pdf',
      issuedAt: '2026-06-19T00:00:00.000Z',
    });

    expect(invoices.save).toHaveBeenCalledWith(
      expect.objectContaining({
        cfdiUuid: 'cfdi-uuid',
        xmlUrl: 'https://files.test/cfdi.xml',
        pdfUrl: 'https://files.test/cfdi.pdf',
        issuedAt: new Date('2026-06-19T00:00:00.000Z'),
        status: InvoiceStatus.Issued,
      }),
    );
    expect(result.status).toBe(InvoiceStatus.Issued);
  });

  it('marks invoice as failed and stores reason', async () => {
    invoices.findOne.mockResolvedValue({
      id: 'invoice-id',
      organizationId: payment.organizationId,
      paymentId: payment.id,
      status: InvoiceStatus.Pending,
      metadata: {},
    });

    await service.markFailed('invoice-id', { reason: 'PAC timeout' });

    expect(invoices.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: InvoiceStatus.Failed,
        metadata: { failureReason: 'PAC timeout' },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.invoice.failed' }),
    );
  });

  it('marks invoice as cancelled', async () => {
    invoices.findOne.mockResolvedValue({
      id: 'invoice-id',
      organizationId: payment.organizationId,
      paymentId: payment.id,
      status: InvoiceStatus.Issued,
      metadata: {},
    });

    await service.markCancelled('invoice-id');

    expect(invoices.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: InvoiceStatus.Cancelled }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.invoice.cancelled' }),
    );
  });

  it('lists invoices by filters', async () => {
    invoices.find.mockResolvedValue([]);

    await service.listInvoices({
      organization_id: payment.organizationId,
      payment_id: payment.id,
      status: InvoiceStatus.Pending,
    });

    expect(invoices.find).toHaveBeenCalledWith({
      where: {
        organizationId: payment.organizationId,
        paymentId: payment.id,
        status: InvoiceStatus.Pending,
      },
      order: { createdAt: 'DESC' },
    });
  });

  it('throws not found when invoice is missing', async () => {
    invoices.findOne.mockResolvedValue(null);

    await expect(service.getInvoice('invoice-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
