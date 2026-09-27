import { billingOperationActor } from '../../common/types/billing-operation-actor';
import { Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { BillingResource } from '../../common/decorators/billing-resource.decorator';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingInvoicesService } from './billing-invoices.service';
import {
  ConsoleBillingInvoiceResponseDto,
  ListBillingInvoicesQueryDto,
} from './dtos';

@Controller('billing/console/invoices')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
export class BillingInvoicesConsoleController {
  constructor(private readonly service: BillingInvoicesService) {}

  @Get()
  @Permissions('billing.invoices.read')
  listInvoices(
    @Query() query: ListBillingInvoicesQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsoleBillingInvoiceResponseDto[]> {
    return this.service.listConsoleInvoices(
      query,
      request.billingOrganizationScope!,
    );
  }

  @Get(':id')
  @Permissions('billing.invoices.read')
  @BillingResource('invoices', 'id')
  getInvoice(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConsoleBillingInvoiceResponseDto> {
    return this.service.getConsoleInvoice(id);
  }

  @Post(':id/issue')
  @Permissions('billing.invoices.issue')
  @BillingResource('invoices', 'id')
  issueInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsoleBillingInvoiceResponseDto> {
    return this.service.issueInvoice(id, billingOperationActor(request));
  }

  @Post(':id/cancel')
  @Permissions('billing.invoices.cancel')
  @BillingResource('invoices', 'id')
  cancelInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsoleBillingInvoiceResponseDto> {
    return this.service.cancelInvoice(id, billingOperationActor(request));
  }
}
