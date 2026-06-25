import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingCheckoutSessionEntity,
  BillingInvoiceEntity,
  BillingLicenseEntity,
  BillingSubscriptionEntity,
  BillingWebhookEventEntity,
  BillingAuditLogEntity,
} from '../billing-shared';
import { BillingSubscriptionsManagementModule } from '../subscriptions-management';
import { BillingOperationsController } from './billing-operations.controller';
import { BillingOperationsService } from './billing-operations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingSubscriptionEntity,
      BillingCheckoutSessionEntity,
      BillingLicenseEntity,
      BillingInvoiceEntity,
      BillingWebhookEventEntity,
      BillingAuditLogEntity,
    ]),
    BillingSubscriptionsManagementModule,
  ],
  controllers: [BillingOperationsController],
  providers: [BillingOperationsService],
})
export class BillingOperationsModule {}
