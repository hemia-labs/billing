import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { BillingWebhooksService } from './billing-webhooks.service';
import { ListConsoleWebhooksQueryDto, RetryWebhookDto } from './dtos';

@Controller('billing/console/webhooks')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
export class BillingWebhooksConsoleController {
  constructor(private readonly service: BillingWebhooksService) {}

  @Get()
  @Permissions('billing.webhooks.read')
  listWebhooks(@Query() query: ListConsoleWebhooksQueryDto) {
    return this.service.listConsoleWebhooks(query);
  }

  @Get(':id')
  @Permissions('billing.webhooks.read')
  getWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getConsoleWebhook(id);
  }

  @Post(':id/retry')
  @Permissions('billing.webhooks.retry')
  retryWebhook(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetryWebhookDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.retryWebhook(id, dto.reason, request.principal!.sub);
  }
}
