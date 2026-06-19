import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingAddonEntity,
  BillingPlanEntity,
  BillingProductEntity,
} from '../billing-shared';
import { BillingCatalogInternalController } from './billing-catalog-internal.controller';
import { BillingCatalogPublicController } from './billing-catalog-public.controller';
import { BillingCatalogService } from './billing-catalog.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingAddonEntity,
      BillingPlanEntity,
      BillingProductEntity,
    ]),
  ],
  controllers: [
    BillingCatalogInternalController,
    BillingCatalogPublicController,
  ],
  providers: [BillingCatalogService],
})
export class BillingCatalogModule {}
