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
import { BillingSubscriptionAddonsModule } from '../subscription-addons';
import { BillingSubscriptionPaymentsProcessorService } from './billing-subscription-payments-processor.service';
import { BillingWebhooksConsoleController } from './billing-webhooks-console.controller';
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
    BillingSubscriptionAddonsModule,
  ],
  controllers: [BillingWebhooksController, BillingWebhooksConsoleController],
  providers: [
    BillingWebhooksService,
    BillingSubscriptionPaymentsProcessorService,
  ],
})
export class BillingWebhooksModule {}
