import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingServiceClientEntity } from './entities/billing-service-client.entity';
import { BillingServiceClientRegistryService } from './services/billing-service-client-registry.service';
import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { BillingConsoleAuthGuard } from './guards/billing-console-auth.guard';
import { BillingInternalAuthGuard } from './guards/billing-internal-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { SsoBearerGuard } from './guards/sso-bearer.guard';
import { BillingServicePolicyGuard } from './guards/billing-service-policy.guard';
import { BillingServicePolicyService } from './services/billing-service-policy.service';
import { BillingResourceContextRepository } from './repositories/billing-resource-context.repository';

@Global()
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([BillingServiceClientEntity])],
  providers: [
    BillingConsoleAuthGuard,
    BillingInternalAuthGuard,
    PermissionsGuard,
    SsoBearerGuard,
    BillingServicePolicyGuard,
    BillingServicePolicyService,
    BillingServiceClientRegistryService,
    BillingResourceContextRepository,
  ],
  exports: [
    AuthModule,
    BillingConsoleAuthGuard,
    BillingInternalAuthGuard,
    PermissionsGuard,
    SsoBearerGuard,
    BillingServicePolicyGuard,
    BillingServicePolicyService,
    BillingServiceClientRegistryService,
  ],
})
export class CommonAuthModule {}
