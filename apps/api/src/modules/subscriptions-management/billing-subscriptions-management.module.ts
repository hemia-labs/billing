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
import { PaypalModule } from '../paypal';
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
    PaypalModule,
  ],
  controllers: [BillingSubscriptionsManagementController],
  providers: [BillingSubscriptionsManagementService],
  exports: [BillingSubscriptionsManagementService],
})
export class BillingSubscriptionsManagementModule {}
