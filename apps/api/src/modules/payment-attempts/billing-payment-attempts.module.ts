import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingCheckoutModule } from '../checkout';
import { BillingSubscriptionsManagementModule } from '../subscriptions-management';
import { BillingPaymentAttemptEntity } from './billing-payment-attempt.entity';
import { BillingPaymentAttemptsController } from './billing-payment-attempts.controller';
import { BillingPaymentAttemptsService } from './billing-payment-attempts.service';
@Module({
  imports: [
    TypeOrmModule.forFeature([BillingPaymentAttemptEntity]),
    BillingCheckoutModule,
    BillingSubscriptionsManagementModule,
  ],
  providers: [BillingPaymentAttemptsService],
  controllers: [BillingPaymentAttemptsController],
})
export class BillingPaymentAttemptsModule {}
