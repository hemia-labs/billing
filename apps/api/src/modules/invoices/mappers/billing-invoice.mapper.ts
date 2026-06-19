import { BillingInvoiceEntity } from '../../billing-shared';
import { BillingInvoiceResponseDto } from '../dtos';

export class BillingInvoiceMapper {
  static toDto(entity: BillingInvoiceEntity): BillingInvoiceResponseDto {
    return {
      id: entity.id,
      organizationId: entity.organizationId,
      paymentId: entity.paymentId,
      cfdiUuid: entity.cfdiUuid,
      rfc: entity.rfc,
      legalName: entity.legalName,
      taxRegime: entity.taxRegime,
      cfdiUse: entity.cfdiUse,
      subtotal: entity.subtotal,
      taxAmount: entity.taxAmount,
      total: entity.total,
      currency: entity.currency,
      status: entity.status,
      xmlUrl: entity.xmlUrl,
      pdfUrl: entity.pdfUrl,
      metadata: entity.metadata,
      issuedAt: entity.issuedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
