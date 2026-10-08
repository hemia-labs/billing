import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { billingServiceAuthorization } from '../../common/types/billing-service-authorization.type';
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
  @BillingServiceAccess({
    resource: 'payments',
    source: 'body',
    parameter: 'paymentId',
  })
  createInvoice(
    @Body() dto: CreateBillingInvoiceDto,
  ): Promise<BillingInvoiceResponseDto> {
    return this.service.createInvoice(dto);
  }

  @Get()
  @BillingServiceAccess('invoice-list')
  listInvoices(
    @Query() query: ListBillingInvoicesQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BillingInvoiceResponseDto[]> {
    return this.service.listInvoices(
      query,
      billingServiceAuthorization(request),
    );
  }

  @Get(':id')
  @BillingServiceAccess({ resource: 'invoices' })
  getInvoice(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillingInvoiceResponseDto> {
    return this.service.getInvoice(id);
  }

  @Patch(':id/issued')
  @BillingServiceAccess({ resource: 'invoices' })
  markIssued(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkBillingInvoiceIssuedDto,
  ): Promise<BillingInvoiceResponseDto> {
    return this.service.markIssued(id, dto);
  }

  @Patch(':id/failed')
  @BillingServiceAccess({ resource: 'invoices' })
  markFailed(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkBillingInvoiceFailedDto,
  ): Promise<BillingInvoiceResponseDto> {
    return this.service.markFailed(id, dto);
  }

  @Patch(':id/cancelled')
  @BillingServiceAccess({ resource: 'invoices' })
  markCancelled(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillingInvoiceResponseDto> {
    return this.service.markCancelled(id);
  }
}
