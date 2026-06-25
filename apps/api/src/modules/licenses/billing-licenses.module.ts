import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingEntitlementsModule } from '../entitlements';
import { BillingLicenseEntity } from '../billing-shared';
import { BillingLicenseCalculatorService } from './billing-license-calculator.service';
import { BillingLicensesController } from './billing-licenses.controller';
import { BillingLicensesService } from './billing-licenses.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BillingLicenseEntity]),
    BillingEntitlementsModule,
  ],
  controllers: [BillingLicensesController],
  providers: [BillingLicenseCalculatorService, BillingLicensesService],
  exports: [BillingLicenseCalculatorService, BillingLicensesService],
})
export class BillingLicensesModule {}
