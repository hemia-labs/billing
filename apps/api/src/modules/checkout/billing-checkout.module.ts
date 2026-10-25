import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingCheckoutSessionEntity,
  BillingCustomerEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingProviderPriceEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import { BillingAuditModule } from '../audit';
import { BillingCatalogModule } from '../catalog';
import { BillingProvidersModule } from '../providers/billing-providers.module';
import { BillingCheckoutController } from './billing-checkout.controller';
import { BillingCheckoutService } from './billing-checkout.service';
import { HemiaLegalClientService } from './clients';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingCheckoutSessionEntity,
      BillingCustomerEntity,
      BillingPlanEntity,
      BillingProductEntity,
      BillingProviderPriceEntity,
      BillingSubscriptionEntity,
    ]),
    BillingAuditModule,
    BillingCatalogModule,
    BillingProvidersModule,
  ],
  controllers: [BillingCheckoutController],
  providers: [BillingCheckoutService, HemiaLegalClientService],
  exports: [BillingCheckoutService],
})
export class BillingCheckoutModule {}
