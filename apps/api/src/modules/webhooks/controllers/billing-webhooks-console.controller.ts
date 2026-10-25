import { BillingResource } from '../../../common/decorators/billing-resource.decorator';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  StreamableFile,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request.type';
import { WebhookPayloadDownloadService } from '../webhook-payload-download.service';
import { DownloadWebhookPayloadDto } from '../dtos/download-webhook-payload.dto';
import { BillingWebhooksService } from '../billing-webhooks.service';
import { ListConsoleWebhooksQueryDto, RetryWebhookDto } from '../dtos';
import { CatalogPaginationQueryDto } from '../../catalog/dtos';

@Controller('billing/console/webhooks')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
export class BillingWebhooksConsoleController {
  constructor(
    private readonly service: BillingWebhooksService,
    private readonly payloadDownload: WebhookPayloadDownloadService,
  ) {}

  @Get()
  @Permissions('billing.webhooks.read')
  listWebhooks(
    @Query() query: ListConsoleWebhooksQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listConsoleWebhooks(
      query,
      request.billingOrganizationScope!,
    );
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @Permissions('billing.webhooks.read')
  @BillingResource('webhook_events', 'id')
  getWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getConsoleWebhook(id);
  }

  @Get(':id/manual-retries')
  @Header('Cache-Control', 'no-store')
  @Permissions('billing.webhooks.read')
  @BillingResource('webhook_events', 'id')
  listManualRetries(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CatalogPaginationQueryDto,
  ) {
    return this.service.listManualRetries(id, query);
  }

  @Post(':id/payload/download')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @Permissions('billing.webhooks.read', 'billing.webhooks.retry')
  @BillingResource('webhook_events', 'id')
  async downloadPayload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DownloadWebhookPayloadDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const { buffer, filename } = await this.payloadDownload.download(
      id,
      dto,
      request,
    );
    return new StreamableFile(buffer, {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
      length: buffer.byteLength,
    });
  }

  @Post(':id/retry')
  @Permissions('billing.webhooks.retry')
  @BillingResource('webhook_events', 'id')
  retryWebhook(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetryWebhookDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.retryWebhook(
      id,
      dto.reason,
      request.principal!.sub,
      request.billingOrganizationScope!,
    );
  }
}
