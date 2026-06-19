import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingAuditLogEntity,
  BillingLicenseEntity,
  BillingPaymentEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
  BillingWebhookEventEntity,
} from '../billing-shared';
import { BillingAuditModule } from '../audit';
import { BillingLicensesModule } from '../licenses';
import { PaypalModule } from '../paypal';
import { BillingSubscriptionPaymentsProcessorService } from './billing-subscription-payments-processor.service';
import { BillingWebhooksController } from './billing-webhooks.controller';
import { BillingWebhooksService } from './billing-webhooks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingWebhookEventEntity,
      BillingSubscriptionEntity,
      BillingPaymentEntity,
      BillingLicenseEntity,
      BillingProductEntity,
      BillingAuditLogEntity,
    ]),
    BillingAuditModule,
    BillingLicensesModule,
    PaypalModule,
  ],
  controllers: [BillingWebhooksController],
  providers: [
    BillingWebhooksService,
    BillingSubscriptionPaymentsProcessorService,
  ],
})
export class BillingWebhooksModule {}
