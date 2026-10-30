import { Controller, Get, Header } from '@nestjs/common';
import { BillingConnectionsService } from './billing-connections.service';

@Controller('billing/integrations/v1/connections')
export class ConnectionDiscoveryController {
  constructor(private readonly connections: BillingConnectionsService) {}

  @Get('discovery')
  @Header('Cache-Control', 'no-store')
  discovery() {
    return this.connections.discovery();
  }
}
