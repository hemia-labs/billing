import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingPaymentEntity } from '../billing-shared';
import { BillingPaymentHistoryController } from './billing-payment-history.controller';
import { BillingPaymentHistoryService } from './billing-payment-history.service';

@Module({
  imports: [TypeOrmModule.forFeature([BillingPaymentEntity])],
  controllers: [BillingPaymentHistoryController],
  providers: [BillingPaymentHistoryService],
})
export class BillingPaymentHistoryModule {}
