import { BillingResource } from '../../../common/decorators/billing-resource.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request.type';
import {
  ConsoleSubscriptionAddonApprovalDto,
  ConsoleSubscriptionAddonResponseDto,
  ConsoleSubscriptionAddonSummaryDto,
  CreateConsoleSubscriptionAddonDto,
} from '../dtos';
import { BillingSubscriptionAddonsService } from '../billing-subscription-addons.service';

@Controller('billing/console')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
export class BillingSubscriptionAddonsConsoleController {
  constructor(private readonly service: BillingSubscriptionAddonsService) {}

  @Post('subscriptions/:subscriptionId/addons')
  @Permissions('billing.addons.create')
  @BillingResource('subscriptions', 'subscriptionId')
  async create(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: CreateConsoleSubscriptionAddonDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsoleSubscriptionAddonApprovalDto> {
    const result = await this.service.createApproval(
      subscriptionId,
      dto,
      request.principal!.sub,
    );
    return {
      addon: this.toAddon(result.addon),
      approvalUrl: result.approvalUrl,
    };
  }

  @Get('subscriptions/:subscriptionId/addons')
  @Permissions('billing.addons.read')
  @BillingResource('subscriptions', 'subscriptionId')
  async summary(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
  ): Promise<ConsoleSubscriptionAddonSummaryDto> {
    const summary = await this.service.getSummary(subscriptionId);
    return {
      ...summary,
      addons: summary.addons.map((addon) => this.toAddon(addon)),
    };
  }

  @Post('subscription-addons/:id/schedule-cancel')
  @Permissions('billing.addons.cancel')
  @BillingResource('subscription_addons', 'id')
  async scheduleCancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsoleSubscriptionAddonResponseDto> {
    return this.toAddon(
      await this.service.scheduleCancel(id, request.principal!.sub),
    );
  }

  private toAddon(addon: {
    id: string;
    addonCode: string;
    quantity: number;
    status: string;
    unitPrice: string;
    currency: string;
    pendingEffectiveAt: Date | null;
    currentPeriodEnd: Date | null;
  }): ConsoleSubscriptionAddonResponseDto {
    return {
      id: addon.id,
      addonCode: addon.addonCode,
      quantity: addon.quantity,
      status: addon.status,
      unitPrice: addon.unitPrice,
      currency: addon.currency,
      pendingEffectiveAt: addon.pendingEffectiveAt,
      currentPeriodEnd: addon.currentPeriodEnd,
    };
  }
}
