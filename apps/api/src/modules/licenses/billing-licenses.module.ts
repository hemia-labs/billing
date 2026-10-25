import { BillingSnapshotsService } from './billing-snapshots.service';
import { BillingSnapshotsController } from './billing-snapshots.controller';
import { LicenseWebhookDeliveryService } from './license-webhook-delivery.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingEntitlementsModule } from '../entitlements';
import { BillingCatalogModule } from '../catalog';
import { BillingLicenseEntity } from '../billing-shared';
import { BillingLicenseCalculatorService } from './billing-license-calculator.service';
import { BillingLicensesController } from './billing-licenses.controller';
import { BillingLicensesService } from './billing-licenses.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BillingLicenseEntity]),
    BillingCatalogModule,
    BillingEntitlementsModule,
  ],
  controllers: [BillingLicensesController, BillingSnapshotsController],
  providers: [
    BillingLicenseCalculatorService,
    BillingLicensesService,
    BillingSnapshotsService,
    LicenseWebhookDeliveryService,
  ],
  exports: [
    BillingLicenseCalculatorService,
    BillingLicensesService,
    BillingSnapshotsService,
    LicenseWebhookDeliveryService,
  ],
})
export class BillingLicensesModule {}
