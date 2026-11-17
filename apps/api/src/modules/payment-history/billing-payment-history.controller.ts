import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { billingServiceActor } from '../../common/types/billing-service-authorization.type';
import { BillingPaymentHistoryService } from './billing-payment-history.service';
import { PaymentHistoryQueryDto } from './payment-history.dto';

@Controller('billing/payments')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
@Permissions('billing.subscriptions.manage')
export class BillingPaymentHistoryController {
  constructor(private readonly service: BillingPaymentHistoryService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @BillingServiceAccess({
    product: 'product_code',
    organization: 'organization_id',
    source: 'query',
  })
  list(
    @Query() query: PaymentHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(query, billingServiceActor(request));
  }
}
