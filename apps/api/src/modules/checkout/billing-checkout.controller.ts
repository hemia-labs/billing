import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { billingServiceActor } from '../../common/types/billing-service-authorization.type';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingCheckoutService } from './billing-checkout.service';
import { CheckoutInProgressFilter } from './filters/checkout-in-progress.filter';
import {
  CheckoutSessionResponseDto,
  CheckoutSessionStatusResponseDto,
  CreateCheckoutSessionDto,
} from './dtos';

@Controller('billing/checkout/sessions')
export class BillingCheckoutController {
  constructor(private readonly service: BillingCheckoutService) {}

  @Post()
  @UseFilters(CheckoutInProgressFilter)
  @BillingServiceAccess({
    product: 'productCode',
    organization: 'organizationId',
    source: 'body',
  })
  @UseGuards(BillingInternalAuthGuard, PermissionsGuard)
  @Permissions('billing.checkout.manage')
  create(
    @Body() dto: CreateCheckoutSessionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CheckoutSessionResponseDto> {
    return this.service.createCheckoutSession(
      dto,
      billingServiceActor(request),
    );
  }

  @Get(':id/status')
  @BillingServiceAccess({ resource: 'checkout_sessions' })
  @UseGuards(BillingInternalAuthGuard, PermissionsGuard)
  @Permissions('billing.checkout.manage')
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CheckoutSessionStatusResponseDto> {
    return this.service.getCheckoutStatus(id, billingServiceActor(request));
  }
}
