import { Controller, Get, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingIdentityOAuthClientsService } from './billing-identity-oauth-clients.service';

@Controller('billing/console/integrations/identity-clients')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
export class BillingIdentityOAuthClientsController {
  constructor(private readonly identity: BillingIdentityOAuthClientsService) {}

  @Get()
  @Permissions('billing.integrations.read')
  list() {
    return this.identity.listServiceClients();
  }
}
