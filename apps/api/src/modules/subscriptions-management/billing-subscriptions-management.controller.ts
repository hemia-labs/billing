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
  UseFilters,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { billingServiceActor } from '../../common/types/billing-service-authorization.type';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingSubscriptionsManagementService } from './billing-subscriptions-management.service';
import { PlanChangeQuoteQueryDto } from './dtos/manage-subscription.dto';
import { CheckoutInProgressFilter } from '../checkout/filters/checkout-in-progress.filter';
import {
  CancelSubscriptionDto,
  ChangePlanDto,
  CurrentSubscriptionQueryDto,
} from './dtos';

@Controller('billing')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
@Permissions('billing.subscriptions.manage')
export class BillingSubscriptionsManagementController {
  constructor(
    private readonly service: BillingSubscriptionsManagementService,
  ) {}

  @Get('subscriptions/current')
  @BillingServiceAccess({
    product: 'product_code',
    organization: 'organization_id',
    source: 'query',
  })
  getCurrent(
    @Query() query: CurrentSubscriptionQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getCurrentSubscription(
      query.organization_id,
      query.product_code,
      billingServiceActor(request),
    );
  }

  @Get('subscriptions/:id/plan-change-quote')
  @BillingServiceAccess({ resource: 'subscriptions' })
  quote(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PlanChangeQuoteQueryDto,
  ) {
    return this.service.quotePlanChange(
      id,
      query.target_plan_code,
      query.target_plan_price_code,
    );
  }

  @Post('subscriptions/:id/cancel')
  @BillingServiceAccess({ resource: 'subscriptions' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.service.cancelSubscription(id, dto);
  }

  @Post('subscriptions/:id/change-plan')
  @UseFilters(CheckoutInProgressFilter)
  @BillingServiceAccess({ resource: 'subscriptions' })
  changePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePlanDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.changePlan(id, dto, billingServiceActor(request));
  }

  @Post('checkout/sessions/:id/verify')
  @BillingServiceAccess({ resource: 'checkout_sessions' })
  verify(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.verifyCheckoutSession(id);
  }
}
