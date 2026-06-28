import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingAddonEntity,
  BillingFeatureDefinitionEntity,
  BillingPlanEntitlementEntity,
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProductEntity,
  BillingProviderPriceEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import { BillingCatalogConsoleController } from './billing-catalog-console.controller';
import { BillingCatalogInternalController } from './billing-catalog-internal.controller';
import { BillingCatalogPublicController } from './billing-catalog-public.controller';
import { BillingCatalogService } from './billing-catalog.service';
import { BillingPlanCatalogResolver } from './billing-plan-catalog.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingAddonEntity,
      BillingFeatureDefinitionEntity,
      BillingPlanEntitlementEntity,
      BillingPlanEntity,
      BillingPlanPriceEntity,
      BillingPlanVersionEntity,
      BillingProductEntity,
      BillingProviderPriceEntity,
      BillingSubscriptionAddonEntity,
      BillingSubscriptionEntity,
    ]),
  ],
  controllers: [
    BillingCatalogInternalController,
    BillingCatalogConsoleController,
    BillingCatalogPublicController,
  ],
  providers: [BillingCatalogService, BillingPlanCatalogResolver],
  exports: [BillingCatalogService, BillingPlanCatalogResolver],
})
export class BillingCatalogModule {}
