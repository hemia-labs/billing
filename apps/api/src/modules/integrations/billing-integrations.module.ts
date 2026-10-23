import { BillingIntegrationAdminController } from './billing-integration-admin.controller';
import { BillingIntegrationAdminService } from './billing-integration-admin.service';
import { BillingIntegrationAdminGuard } from './billing-integration-admin.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingServiceClientEntity } from '../../common/entities/billing-service-client.entity';
import { BillingProductEntity } from '../billing-shared/entities/billing-product.entity';
import { BillingAuditModule } from '../audit/billing-audit.module';
import { BillingServiceClientsController } from './service-clients/billing-service-clients.controller';
import { BillingServiceClientsService } from './service-clients/billing-service-clients.service';
import { BillingIdentityOAuthClientsController } from './oauth-clients/billing-identity-oauth-clients.controller';
import { BillingIdentityOAuthClientsService } from './oauth-clients/billing-identity-oauth-clients.service';
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
    BillingIntegrationAdminController,
    BillingServiceClientsController,
    BillingIdentityOAuthClientsController,
  ],
  providers: [
    BillingServiceClientsService,
    BillingIdentityOAuthClientsService,
    BillingIntegrationAdminService,
    BillingIntegrationAdminGuard,
  ],
})
export class BillingIntegrationsModule {}
