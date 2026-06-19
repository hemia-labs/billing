import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingCheckoutSessionEntity,
  BillingCustomerEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import { BillingAuditModule } from '../audit';
import { PaypalModule } from '../paypal';
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
      BillingSubscriptionEntity,
    ]),
    BillingAuditModule,
    PaypalModule,
  ],
  controllers: [BillingCheckoutController],
  providers: [BillingCheckoutService, HemiaLegalClientService],
  exports: [BillingCheckoutService],
})
export class BillingCheckoutModule {}
