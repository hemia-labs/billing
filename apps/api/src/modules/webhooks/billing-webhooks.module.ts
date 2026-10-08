import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingAuditLogEntity,
  BillingLicenseEntity,
  BillingPaymentEntity,
  BillingPaymentRefundEntity,
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
import { BillingPaypalRefundsService } from './billing-paypal-refunds.service';
import { PaypalCancellationWorker } from './paypal-cancellation-worker';
import { PaypalWebhookWorker } from './paypal-webhook-worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingWebhookEventEntity,
      BillingSubscriptionEntity,
      BillingPaymentEntity,
      BillingPaymentRefundEntity,
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
    BillingPaypalRefundsService,
    PaypalCancellationWorker,
    PaypalWebhookWorker,
  ],
})
export class BillingWebhooksModule {}
