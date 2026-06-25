import { Global, Module } from '@nestjs/common';
import { BillingConsoleAuthGuard } from './guards/billing-console-auth.guard';
import { BillingInternalApiKeyGuard } from './guards/billing-internal-api-key.guard';
import { BillingInternalAuthGuard } from './guards/billing-internal-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { SsoBearerGuard } from './guards/sso-bearer.guard';

@Global()
@Module({
  providers: [
    BillingInternalApiKeyGuard,
    BillingConsoleAuthGuard,
    BillingInternalAuthGuard,
    PermissionsGuard,
    SsoBearerGuard,
  ],
  exports: [
    BillingInternalApiKeyGuard,
    BillingConsoleAuthGuard,
    BillingInternalAuthGuard,
    PermissionsGuard,
    SsoBearerGuard,
  ],
})
export class CommonAuthModule {}
