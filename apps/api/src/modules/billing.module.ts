import { BillingPaymentHistoryModule } from './payment-history/billing-payment-history.module';
import { BillingPaymentAttemptsModule } from './payment-attempts/billing-payment-attempts.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAuditModule } from './audit';
import { BillingCatalogModule } from './catalog/billing-catalog.module';
import { BillingCopilotModule } from './copilot/billing-copilot.module';
import { BillingCheckoutModule } from './checkout';
import { BillingEntitlementsModule } from './entitlements';
import { BillingInvoicesModule } from './invoices';
import { BillingLicensesModule } from './licenses';
import { BillingIntegrationsModule } from './integrations';
import { BillingSubscriptionsManagementModule } from './subscriptions-management';
import { BillingSubscriptionAddonsModule } from './subscription-addons';
import { BillingWebhooksModule } from './webhooks';
import { PaypalModule } from './paypal';
import { PaypalConnectionsModule } from './paypal-connections/paypal-connections.module';
import { BillingOperationsModule } from './operations';
import {
  BillingAddonEntity,
  BillingAuditLogEntity,
  BillingCheckoutSessionEntity,
  BillingCustomerEntity,
  BillingEntitlementEntity,
  BillingFeatureDefinitionEntity,
  BillingInvoiceEntity,
  BillingLicenseEntity,
  BillingPaymentEntity,
  BillingPlanEntitlementEntity,
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProductEntity,
  BillingTenantEntity,
  BillingProviderPriceEntity,
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
      BillingFeatureDefinitionEntity,
      BillingInvoiceEntity,
      BillingLicenseEntity,
      BillingPaymentEntity,
      BillingPlanEntitlementEntity,
      BillingPlanEntity,
      BillingPlanPriceEntity,
      BillingPlanVersionEntity,
      BillingProductEntity,
      BillingTenantEntity,
      BillingProviderPriceEntity,
      BillingSubscriptionAddonEntity,
      BillingSubscriptionEntity,
      BillingUsageCounterEntity,
      BillingWebhookEventEntity,
    ]),
    BillingAuditModule,
    BillingCatalogModule,
    BillingCopilotModule,
    BillingCheckoutModule,
    BillingEntitlementsModule,
    BillingInvoicesModule,
    BillingLicensesModule,
    BillingIntegrationsModule,
    BillingPaymentAttemptsModule,
    BillingPaymentHistoryModule,
    BillingOperationsModule,
    BillingSubscriptionsManagementModule,
    BillingSubscriptionAddonsModule,
    BillingWebhooksModule,
    PaypalModule,
    PaypalConnectionsModule,
  ],
})
export class BillingModule {}
