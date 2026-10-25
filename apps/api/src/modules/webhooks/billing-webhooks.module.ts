import { BillingProvidersModule } from '../providers/billing-providers.module';
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
import { BillingSubscriptionPaymentsProcessorService } from './paypal/billing-subscription-payments-processor.service';
import { BillingWebhooksConsoleController } from './controllers/billing-webhooks-console.controller';
import { BillingWebhooksController } from './controllers/billing-webhooks.controller';
import { WebhookPayloadDownloadService } from './webhook-payload-download.service';
import { BillingWebhooksService } from './billing-webhooks.service';
import { BillingPaypalRefundsService } from './paypal/billing-paypal-refunds.service';
import { PaypalCancellationWorker } from './paypal/paypal-cancellation-worker';
import { PaypalWebhookWorker } from './paypal/paypal-webhook-worker';

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
    BillingProvidersModule,
    BillingSubscriptionAddonsModule,
  ],
  controllers: [BillingWebhooksController, BillingWebhooksConsoleController],
  providers: [
    BillingWebhooksService,
    WebhookPayloadDownloadService,
    BillingSubscriptionPaymentsProcessorService,
    BillingPaypalRefundsService,
    PaypalCancellationWorker,
    PaypalWebhookWorker,
  ],
})
export class BillingWebhooksModule {}
