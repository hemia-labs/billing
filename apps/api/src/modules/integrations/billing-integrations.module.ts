import { Module } from '@nestjs/common';
import { BillingCatalogModule } from '../catalog';
import { BillingCheckoutModule } from '../checkout';
import { BillingLicensesModule } from '../licenses';
import { BillingIntegrationsController } from './billing-integrations.controller';

@Module({
  imports: [BillingCatalogModule, BillingCheckoutModule, BillingLicensesModule],
  controllers: [BillingIntegrationsController],
})
export class BillingIntegrationsModule {}
