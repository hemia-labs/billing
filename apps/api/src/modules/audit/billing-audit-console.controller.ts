import { Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { BillingResource } from '../../common/decorators/billing-resource.decorator';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  listAuditLogs(
    @Query() query: ListConsoleAuditLogsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listAuditLogs(query, request.billingOrganizationScope!);
  }

  @Get(':id')
  @BillingResource('audit_logs', 'id')
  getAuditLog(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getAuditLog(id);
  }
}
