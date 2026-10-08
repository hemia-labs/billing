import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BillingConsoleAuthGuard } from '../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { BillingServiceClientsService } from './billing-service-clients.service';
import { SaveServiceClientDto } from './dtos/save-service-client.dto';

@Controller('billing/console/integrations/clients')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
export class BillingServiceClientsController {
  constructor(private readonly service: BillingServiceClientsService) {}

  @Get()
  @Permissions('billing.integrations.read')
  list() {
    return this.service.list();
  }

  @Put(':clientId')
  @Permissions('billing.integrations.manage')
  save(
    @Param('clientId') clientId: string,
    @Body() dto: SaveServiceClientDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.save(clientId, dto, request.principal!.sub);
  }
}
