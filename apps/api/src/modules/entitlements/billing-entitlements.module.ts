import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAuditModule } from '../audit';
import {
  BillingEntitlementEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import { BillingEntitlementsService } from './billing-entitlements.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingEntitlementEntity,
      BillingSubscriptionAddonEntity,
      BillingSubscriptionEntity,
    ]),
    BillingAuditModule,
  ],
  providers: [BillingEntitlementsService],
  exports: [BillingEntitlementsService],
})
export class BillingEntitlementsModule {}
