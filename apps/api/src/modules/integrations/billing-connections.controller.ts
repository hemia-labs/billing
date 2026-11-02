import { Controller, Get, Header, Param, Req, UseGuards } from '@nestjs/common';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { BillingConnectionsService } from './billing-connections.service';

@Controller('billing/integrations/v1/connections')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
export class BillingConnectionsController {
  constructor(private readonly connections: BillingConnectionsService) {}

  @Get(':connectionCode')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('billing.integration.catalog.read')
  @BillingServiceAccess('catalog')
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param('connectionCode') code: string,
  ) {
    return this.connections.resolve(request, code);
  }
}
