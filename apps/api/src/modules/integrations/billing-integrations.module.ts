import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingServiceClientEntity } from '../../common/entities/billing-service-client.entity';
import { BillingProductEntity } from '../billing-shared/entities/billing-product.entity';
import { BillingAuditModule } from '../audit/billing-audit.module';
import { BillingServiceClientsController } from './billing-service-clients.controller';
import { BillingServiceClientsService } from './billing-service-clients.service';
import { BillingIdentityOAuthClientsController } from './billing-identity-oauth-clients.controller';
import { BillingIdentityOAuthClientsService } from './billing-identity-oauth-clients.service';
import { Module } from '@nestjs/common';
import { BillingCatalogModule } from '../catalog';
import { BillingCheckoutModule } from '../checkout';
import { BillingLicensesModule } from '../licenses';
import { BillingIntegrationsController } from './billing-integrations.controller';

@Module({
  imports: [
    BillingCatalogModule,
    BillingCheckoutModule,
    BillingLicensesModule,
    BillingAuditModule,
    TypeOrmModule.forFeature([
      BillingServiceClientEntity,
      BillingProductEntity,
    ]),
  ],
  controllers: [
    BillingIntegrationsController,
    BillingServiceClientsController,
    BillingIdentityOAuthClientsController,
  ],
  providers: [
    BillingServiceClientsService,
    BillingIdentityOAuthClientsService,
  ],
})
export class BillingIntegrationsModule {}
