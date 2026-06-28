import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAuditModule } from '../audit';
import { BillingCatalogModule } from '../catalog';
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
    BillingCatalogModule,
  ],
  providers: [BillingEntitlementsService],
  exports: [BillingEntitlementsService],
})
export class BillingEntitlementsModule {}
