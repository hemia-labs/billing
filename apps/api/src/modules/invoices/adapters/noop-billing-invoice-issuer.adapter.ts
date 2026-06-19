import { Injectable, NotImplementedException } from '@nestjs/common';
import { BillingInvoiceIssuerAdapter } from './billing-invoice-issuer.adapter';

@Injectable()
export class NoopBillingInvoiceIssuerAdapter
  implements BillingInvoiceIssuerAdapter
{
  async issue(): Promise<never> {
    throw new NotImplementedException('PAC invoice issuing is not configured');
  }

  async cancel(): Promise<never> {
    throw new NotImplementedException('PAC invoice cancellation is not configured');
  }
}
