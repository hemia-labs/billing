import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAuditModule } from '../audit';
import { BillingCheckoutModule } from '../checkout';
import { BillingCatalogModule } from '../catalog';
import { BillingEntitlementsModule } from '../entitlements';
import {
  BillingCheckoutSessionEntity,
  BillingLicenseEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import { BillingLicensesModule } from '../licenses';
import { BillingProvidersModule } from '../providers/billing-providers.module';
import { BillingSubscriptionsManagementController } from './billing-subscriptions-management.controller';
import { BillingSubscriptionsManagementService } from './billing-subscriptions-management.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingCheckoutSessionEntity,
      BillingLicenseEntity,
      BillingPlanEntity,
      BillingProductEntity,
      BillingSubscriptionEntity,
    ]),
    BillingAuditModule,
    BillingCatalogModule,
    BillingCheckoutModule,
    BillingEntitlementsModule,
    BillingLicensesModule,
    BillingProvidersModule,
  ],
  controllers: [BillingSubscriptionsManagementController],
  providers: [BillingSubscriptionsManagementService],
  exports: [BillingSubscriptionsManagementService],
})
export class BillingSubscriptionsManagementModule {}
