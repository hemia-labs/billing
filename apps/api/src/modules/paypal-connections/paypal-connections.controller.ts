import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Post,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PaypalConnectionsService } from './paypal-connections.service';
import {
  RotatePaypalConnectionDto,
  SavePaypalConnectionDto,
  ActivatePaypalConnectionDto,
  PaypalConnectionStatusDto,
} from './paypal-connection.dto';

@Controller('billing/console/catalog/products/:id')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
export class PaypalConnectionsController {
  constructor(private readonly service: PaypalConnectionsService) {}
  @Get('paypal-connection')
  @Permissions('billing.catalog.read')
  @Header('Cache-Control', 'no-store')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }
  @Put('paypal-connection')
  @Permissions('billing.catalog.manage')
  @Header('Cache-Control', 'no-store')
  save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SavePaypalConnectionDto,
  ) {
    return this.service.save(id, dto);
  }
  @Post('paypal-connections/:connectionId/activate')
  @HttpCode(200)
  @Permissions('billing.catalog.manage')
  @Header('Cache-Control', 'no-store')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Body() dto: ActivatePaypalConnectionDto,
  ) {
    return this.service.activate(id, connectionId, dto);
  }
  @Patch('paypal-connections/:connectionId/status')
  @Permissions('billing.catalog.manage')
  @Header('Cache-Control', 'no-store')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Body() dto: PaypalConnectionStatusDto,
  ) {
    return this.service.setStatus(id, connectionId, dto);
  }
  @Get('paypal-connections')
  @Permissions('billing.catalog.read')
  @Header('Cache-Control', 'no-store')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.list(id);
  }
  @Patch('paypal-connections/:connectionId')
  @Permissions('billing.catalog.manage')
  @Header('Cache-Control', 'no-store')
  rotate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Body() dto: RotatePaypalConnectionDto,
  ) {
    return this.service.rotate(id, connectionId, dto);
  }
}
