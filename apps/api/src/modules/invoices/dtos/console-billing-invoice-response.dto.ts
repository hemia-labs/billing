import type { BillingCurrency } from '../../billing-shared';
import { InvoiceStatus } from '../../billing-shared';

export class ConsoleBillingInvoiceResponseDto {
  id: string;
  organizationId: string;
  paymentId: string;
  cfdiUuid: string | null;
  rfc: string;
  legalName: string;
  taxRegime: string;
  cfdiUse: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  currency: BillingCurrency;
  status: InvoiceStatus;
  xmlUrl: string | null;
  pdfUrl: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
