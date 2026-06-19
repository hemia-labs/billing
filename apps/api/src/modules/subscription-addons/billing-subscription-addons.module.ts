import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAuditModule } from '../audit';
import { BillingEntitlementsModule } from '../entitlements';
import {
  BillingAddonEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
  BillingUsageCounterEntity,
} from '../billing-shared';
import { BillingSubscriptionAddonsController } from './billing-subscription-addons.controller';
import { BillingSubscriptionAddonsService } from './billing-subscription-addons.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingSubscriptionAddonEntity,
      BillingSubscriptionEntity,
      BillingAddonEntity,
      BillingUsageCounterEntity,
    ]),
    BillingAuditModule,
    BillingEntitlementsModule,
  ],
  controllers: [BillingSubscriptionAddonsController],
  providers: [BillingSubscriptionAddonsService],
  exports: [BillingSubscriptionAddonsService],
})
export class BillingSubscriptionAddonsModule {}
