import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingAuditService } from './billing-audit.service';
import { ListConsoleAuditLogsQueryDto } from './dtos';

@Controller('billing/console/audit')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
@Permissions('billing.audit.read')
export class BillingAuditConsoleController {
  constructor(private readonly service: BillingAuditService) {}

  @Get()
  listAuditLogs(@Query() query: ListConsoleAuditLogsQueryDto) {
    return this.service.listAuditLogs(query);
  }

  @Get(':id')
  getAuditLog(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getAuditLog(id);
  }
}
