import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAuditModule } from './audit';
import { BillingCatalogModule } from './catalog/billing-catalog.module';
import { BillingCheckoutModule } from './checkout';
import { BillingEntitlementsModule } from './entitlements';
import { BillingInvoicesModule } from './invoices';
import { BillingLicensesModule } from './licenses';
import { BillingSubscriptionsManagementModule } from './subscriptions-management';
import { BillingSubscriptionAddonsModule } from './subscription-addons';
import { BillingWebhooksModule } from './webhooks';
import { PaypalModule } from './paypal';
import {
  BillingAddonEntity,
  BillingAuditLogEntity,
  BillingCheckoutSessionEntity,
  BillingCustomerEntity,
  BillingEntitlementEntity,
  BillingInvoiceEntity,
  BillingLicenseEntity,
  BillingPaymentEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
  BillingUsageCounterEntity,
  BillingWebhookEventEntity,
} from './billing-shared/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingAddonEntity,
      BillingAuditLogEntity,
      BillingCheckoutSessionEntity,
      BillingCustomerEntity,
      BillingEntitlementEntity,
      BillingInvoiceEntity,
      BillingLicenseEntity,
      BillingPaymentEntity,
      BillingPlanEntity,
      BillingProductEntity,
      BillingSubscriptionAddonEntity,
      BillingSubscriptionEntity,
      BillingUsageCounterEntity,
      BillingWebhookEventEntity,
    ]),
    BillingAuditModule,
    BillingCatalogModule,
    BillingCheckoutModule,
    BillingEntitlementsModule,
    BillingInvoicesModule,
    BillingLicensesModule,
    BillingSubscriptionsManagementModule,
    BillingSubscriptionAddonsModule,
    BillingWebhooksModule,
    PaypalModule,
  ],
})
export class BillingModule {}
