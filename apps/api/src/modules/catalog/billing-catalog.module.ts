import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingAddonEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import { BillingCatalogConsoleController } from './billing-catalog-console.controller';
import { BillingCatalogInternalController } from './billing-catalog-internal.controller';
import { BillingCatalogPublicController } from './billing-catalog-public.controller';
import { BillingCatalogService } from './billing-catalog.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingAddonEntity,
      BillingPlanEntity,
      BillingProductEntity,
      BillingSubscriptionAddonEntity,
      BillingSubscriptionEntity,
    ]),
  ],
  controllers: [
    BillingCatalogInternalController,
    BillingCatalogConsoleController,
    BillingCatalogPublicController,
  ],
  providers: [BillingCatalogService],
  exports: [BillingCatalogService],
})
export class BillingCatalogModule {}
