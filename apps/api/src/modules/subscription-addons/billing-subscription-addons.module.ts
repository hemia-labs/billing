import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAuditModule } from '../audit';
import { BillingCatalogModule } from '../catalog';
import { BillingEntitlementsModule } from '../entitlements';
import { BillingProvidersModule } from '../providers/billing-providers.module';
import {
  BillingAddonEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
  BillingUsageCounterEntity,
} from '../billing-shared';
import { BillingSubscriptionAddonsController } from './controllers/billing-subscription-addons.controller';
import { BillingSubscriptionAddonsConsoleController } from './controllers/billing-subscription-addons-console.controller';
import { BillingSubscriptionAddonPaymentsProcessorService } from './billing-subscription-addon-payments-processor.service';
import { BillingSubscriptionAddonsService } from './billing-subscription-addons.service';
import { BillingSubscriptionAddonsWorker } from './billing-subscription-addons.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingSubscriptionAddonEntity,
      BillingSubscriptionEntity,
      BillingAddonEntity,
      BillingUsageCounterEntity,
    ]),
    BillingAuditModule,
    BillingCatalogModule,
    BillingEntitlementsModule,
    BillingProvidersModule,
  ],
  controllers: [
    BillingSubscriptionAddonsController,
    BillingSubscriptionAddonsConsoleController,
  ],
  providers: [
    BillingSubscriptionAddonsService,
    BillingSubscriptionAddonPaymentsProcessorService,
    BillingSubscriptionAddonsWorker,
  ],
  exports: [
    BillingSubscriptionAddonsService,
    BillingSubscriptionAddonPaymentsProcessorService,
  ],
})
export class BillingSubscriptionAddonsModule {}
