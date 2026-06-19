import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAuditModule } from '../audit';
import { BillingInvoiceEntity, BillingPaymentEntity } from '../billing-shared';
import {
  BILLING_INVOICE_ISSUER_ADAPTER,
  NoopBillingInvoiceIssuerAdapter,
} from './adapters';
import { BillingInvoicesController } from './billing-invoices.controller';
import { BillingInvoicesService } from './billing-invoices.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BillingInvoiceEntity, BillingPaymentEntity]),
    BillingAuditModule,
  ],
  controllers: [BillingInvoicesController],
  providers: [
    BillingInvoicesService,
    NoopBillingInvoiceIssuerAdapter,
    {
      provide: BILLING_INVOICE_ISSUER_ADAPTER,
      useExisting: NoopBillingInvoiceIssuerAdapter,
    },
  ],
  exports: [BillingInvoicesService],
})
export class BillingInvoicesModule {}
