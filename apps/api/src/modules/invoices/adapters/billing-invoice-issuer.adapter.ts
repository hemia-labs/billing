import type { BillingInvoiceEntity } from '../../billing-shared';

export type BillingInvoiceIssuerResult = {
  cfdiUuid: string;
  xmlUrl: string;
  pdfUrl: string;
  issuedAt: Date;
  provider?: string;
  providerReference?: string;
};

export interface BillingInvoiceIssuerAdapter {
  issue(
    invoice: BillingInvoiceEntity,
    idempotencyKey: string,
  ): Promise<BillingInvoiceIssuerResult>;
  cancel(
    invoice: BillingInvoiceEntity,
    idempotencyKey: string,
  ): Promise<{ providerReference?: string } | void>;
}

export const BILLING_INVOICE_ISSUER_ADAPTER = Symbol(
  'BILLING_INVOICE_ISSUER_ADAPTER',
);
