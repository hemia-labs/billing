import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { BillingIntegrationAdminGuard } from './billing-integration-admin.guard';
import { BillingIntegrationAdminService } from './billing-integration-admin.service';
import { BillingServiceClientsService } from './service-clients/billing-service-clients.service';
import { SaveServiceClientDto } from './dtos/save-service-client.dto';
import { SaveLicenseReceiverDto } from './dtos/save-license-receiver.dto';

@Controller('billing/integrations/admin')
@UseGuards(BillingIntegrationAdminGuard)
export class BillingIntegrationAdminController {
  constructor(
    private readonly admin: BillingIntegrationAdminService,
    private readonly clients: BillingServiceClientsService,
  ) {}
  @Get('options')
  @Permissions('billing.integrations.read')
  options() {
    return this.admin.options();
  }
  @Put('clients/:clientId')
  @Permissions('billing.integrations.manage')
  saveClient(
    @Param('clientId') clientId: string,
    @Body() dto: SaveServiceClientDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.clients.save(
      clientId,
      dto,
      request.header('x-hemia-actor-subject')!,
      request.principal!.clientId,
    );
  }
  @Put('receivers/:productCode')
  @Permissions('billing.integrations.manage')
  saveReceiver(
    @Param('productCode') productCode: string,
    @Body() dto: SaveLicenseReceiverDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.saveReceiver(
      productCode,
      dto,
      request.header('x-hemia-actor-subject')!,
      request.principal!.clientId!,
    );
  }
  @Post('receivers/:productCode/check')
  @Permissions('billing.integrations.manage')
  checkReceiver(@Param('productCode') productCode: string) {
    return this.admin.checkReceiver(productCode);
  }
}
