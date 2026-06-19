import { Global, Module } from '@nestjs/common';
import { BillingInternalApiKeyGuard } from './guards/billing-internal-api-key.guard';
import { BillingInternalAuthGuard } from './guards/billing-internal-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { SsoBearerGuard } from './guards/sso-bearer.guard';

@Global()
@Module({
  providers: [
    BillingInternalApiKeyGuard,
    BillingInternalAuthGuard,
    PermissionsGuard,
    SsoBearerGuard,
  ],
  exports: [
    BillingInternalApiKeyGuard,
    BillingInternalAuthGuard,
    PermissionsGuard,
    SsoBearerGuard,
  ],
})
export class CommonAuthModule {}
