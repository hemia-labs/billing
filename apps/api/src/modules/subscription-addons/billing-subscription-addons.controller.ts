import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingSubscriptionAddonsService } from './billing-subscription-addons.service';
import {
  CreateSubscriptionAddonDto,
  SubscriptionAddonResponseDto,
  SubscriptionAddonSummaryResponseDto,
} from './dtos';

@Controller('billing')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
@Permissions('billing.addons.manage')
export class BillingSubscriptionAddonsController {
  constructor(private readonly service: BillingSubscriptionAddonsService) {}

  @Post('subscriptions/:subscriptionId/addons')
  @BillingServiceAccess({
    resource: 'subscriptions',
    parameter: 'subscriptionId',
  })
  createPendingAddon(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: CreateSubscriptionAddonDto,
  ): Promise<SubscriptionAddonResponseDto> {
    return this.service.createPendingAddon(subscriptionId, dto);
  }

  @Get('subscriptions/:subscriptionId/addons')
  @BillingServiceAccess({
    resource: 'subscriptions',
    parameter: 'subscriptionId',
  })
  getSummary(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
  ): Promise<SubscriptionAddonSummaryResponseDto> {
    return this.service.getSummary(subscriptionId);
  }

  @Post('subscription-addons/:id/schedule-cancel')
  @BillingServiceAccess({ resource: 'subscription_addons' })
  scheduleCancel(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionAddonResponseDto> {
    return this.service.scheduleCancel(id);
  }
}
