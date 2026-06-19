import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingSubscriptionsManagementService } from './billing-subscriptions-management.service';
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
  getCurrent(@Query() query: CurrentSubscriptionQueryDto) {
    return this.service.getCurrentSubscription(
      query.organization_id,
      query.product_code,
    );
  }

  @Post('subscriptions/:id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.service.cancelSubscription(id, dto);
  }

  @Post('subscriptions/:id/change-plan')
  changePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePlanDto,
  ) {
    return this.service.changePlan(id, dto);
  }

  @Post('checkout/sessions/:id/verify')
  verify(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.verifyCheckoutSession(id);
  }
}
