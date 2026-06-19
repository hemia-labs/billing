import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingInvoicesService } from './billing-invoices.service';
import {
  BillingInvoiceResponseDto,
  CreateBillingInvoiceDto,
  ListBillingInvoicesQueryDto,
  MarkBillingInvoiceFailedDto,
  MarkBillingInvoiceIssuedDto,
} from './dtos';

@Controller('billing/invoices')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
@Permissions('billing.invoices.manage')
export class BillingInvoicesController {
  constructor(private readonly service: BillingInvoicesService) {}

  @Post()
  createInvoice(
    @Body() dto: CreateBillingInvoiceDto,
  ): Promise<BillingInvoiceResponseDto> {
    return this.service.createInvoice(dto);
  }

  @Get()
  listInvoices(
    @Query() query: ListBillingInvoicesQueryDto,
  ): Promise<BillingInvoiceResponseDto[]> {
    return this.service.listInvoices(query);
  }

  @Get(':id')
  getInvoice(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillingInvoiceResponseDto> {
    return this.service.getInvoice(id);
  }

  @Patch(':id/issued')
  markIssued(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkBillingInvoiceIssuedDto,
  ): Promise<BillingInvoiceResponseDto> {
    return this.service.markIssued(id, dto);
  }

  @Patch(':id/failed')
  markFailed(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkBillingInvoiceFailedDto,
  ): Promise<BillingInvoiceResponseDto> {
    return this.service.markFailed(id, dto);
  }

  @Patch(':id/cancelled')
  markCancelled(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillingInvoiceResponseDto> {
    return this.service.markCancelled(id);
  }
}
