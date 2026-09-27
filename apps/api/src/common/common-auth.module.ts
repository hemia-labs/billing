import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { BillingConsoleAuthGuard } from './guards/billing-console-auth.guard';
import { BillingInternalAuthGuard } from './guards/billing-internal-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { SsoBearerGuard } from './guards/sso-bearer.guard';

@Global()
@Module({
  imports: [AuthModule],
  providers: [
    BillingConsoleAuthGuard,
    BillingInternalAuthGuard,
    PermissionsGuard,
    SsoBearerGuard,
  ],
  exports: [
    AuthModule,
    BillingConsoleAuthGuard,
    BillingInternalAuthGuard,
    PermissionsGuard,
    SsoBearerGuard,
  ],
})
export class CommonAuthModule {}
