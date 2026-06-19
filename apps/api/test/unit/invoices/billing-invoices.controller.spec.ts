import { Test } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BillingInternalAuthGuard } from 'src/common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from 'src/common/guards/permissions.guard';
import { BillingInvoicesController } from 'src/modules/invoices/billing-invoices.controller';
import { BillingInvoicesService } from 'src/modules/invoices/billing-invoices.service';

describe('BillingInvoicesController', () => {
  let controller: BillingInvoicesController;
  let service: {
    createInvoice: jest.Mock;
    listInvoices: jest.Mock;
    getInvoice: jest.Mock;
    markIssued: jest.Mock;
    markFailed: jest.Mock;
    markCancelled: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createInvoice: jest.fn(),
      listInvoices: jest.fn(),
      getInvoice: jest.fn(),
      markIssued: jest.fn(),
      markFailed: jest.fn(),
      markCancelled: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingInvoicesController],
      providers: [{ provide: BillingInvoicesService, useValue: service }],
    })
      .overrideGuard(BillingInternalAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = moduleRef.get(BillingInvoicesController);
  });

  it('delegates create invoice to service', async () => {
    service.createInvoice.mockResolvedValue({ id: 'invoice-id' });

    await expect(
      controller.createInvoice({
        organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
        paymentId: '9d709aa0-09da-4d56-a71f-44fd4e917c8d',
        rfc: 'XAXX010101000',
        legalName: 'Clinica Hemia SA de CV',
        taxRegime: '601',
        cfdiUse: 'G03',
      }),
    ).resolves.toEqual({ id: 'invoice-id' });
  });

  it('uses internal auth and permissions guards', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      BillingInvoicesController,
    );

    expect(guards).toEqual([BillingInternalAuthGuard, PermissionsGuard]);
  });

  it('delegates status updates to service', async () => {
    service.markIssued.mockResolvedValue({ id: 'invoice-id' });
    service.markFailed.mockResolvedValue({ id: 'invoice-id' });
    service.markCancelled.mockResolvedValue({ id: 'invoice-id' });

    await controller.markIssued('invoice-id', {
      cfdiUuid: 'cfdi-uuid',
      xmlUrl: 'https://files.test/cfdi.xml',
      pdfUrl: 'https://files.test/cfdi.pdf',
    });
    await controller.markFailed('invoice-id', { reason: 'PAC timeout' });
    await controller.markCancelled('invoice-id');

    expect(service.markIssued).toHaveBeenCalled();
    expect(service.markFailed).toHaveBeenCalled();
    expect(service.markCancelled).toHaveBeenCalledWith('invoice-id');
  });
});
