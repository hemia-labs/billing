import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingInvoicesService } from './billing-invoices.service';
import { ConsoleBillingInvoiceResponseDto, ListBillingInvoicesQueryDto } from './dtos';

@Controller('billing/console/invoices')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
export class BillingInvoicesConsoleController {
  constructor(private readonly service: BillingInvoicesService) {}

  @Get()
  @Permissions('billing.invoices.read')
  listInvoices(
    @Query() query: ListBillingInvoicesQueryDto,
  ): Promise<ConsoleBillingInvoiceResponseDto[]> {
    return this.service.listConsoleInvoices(query);
  }

  @Get(':id')
  @Permissions('billing.invoices.read')
  getInvoice(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConsoleBillingInvoiceResponseDto> {
    return this.service.getConsoleInvoice(id);
  }

  @Post(':id/issue')
  @Permissions('billing.invoices.manage')
  issueInvoice(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConsoleBillingInvoiceResponseDto> {
    return this.service.issueInvoice(id);
  }

  @Post(':id/cancel')
  @Permissions('billing.invoices.manage')
  cancelInvoice(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConsoleBillingInvoiceResponseDto> {
    return this.service.cancelInvoice(id);
  }
}
