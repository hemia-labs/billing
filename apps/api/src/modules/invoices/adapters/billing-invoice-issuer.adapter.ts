export type BillingInvoiceIssuerResult = {
  cfdiUuid: string;
  xmlUrl: string;
  pdfUrl: string;
  issuedAt: Date;
};

export interface BillingInvoiceIssuerAdapter {
  issue(): Promise<BillingInvoiceIssuerResult>;
  cancel(cfdiUuid: string): Promise<void>;
}

export const BILLING_INVOICE_ISSUER_ADAPTER = Symbol(
  'BILLING_INVOICE_ISSUER_ADAPTER',
);
