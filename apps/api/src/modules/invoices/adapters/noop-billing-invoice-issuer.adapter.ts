import {
  Injectable,
  NotImplementedException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingInvoiceIssuerAdapter } from './billing-invoice-issuer.adapter';

@Injectable()
export class NoopBillingInvoiceIssuerAdapter
  implements BillingInvoiceIssuerAdapter, OnModuleInit
{
  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (
      this.config.get<string>('app.nodeEnv') === 'production' &&
      this.config.get<string>('billingFiscal.provider') !== 'disabled'
    ) {
      throw new Error(
        'PAC invoice issuer is required in production; explicitly set BILLING_FISCAL_PROVIDER=disabled to disable fiscal invoicing',
      );
    }
  }

  assertAvailable(): void {
    throw new NotImplementedException('Fiscal invoicing is disabled');
  }

  issue(): Promise<never> {
    return Promise.reject(
      new NotImplementedException('PAC invoice issuing is not configured'),
    );
  }

  cancel(): Promise<never> {
    return Promise.reject(
      new NotImplementedException('PAC invoice cancellation is not configured'),
    );
  }
}
