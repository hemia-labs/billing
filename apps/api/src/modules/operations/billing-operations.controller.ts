import { BillingResource } from '../../common/decorators/billing-resource.decorator';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { BillingSubscriptionsManagementService } from '../subscriptions-management';
import {
  ListConsoleCheckoutsQueryDto,
  ListConsoleLicensesQueryDto,
  ListConsoleSubscriptionsQueryDto,
} from './dtos';
import { BillingOperationsService } from './billing-operations.service';

@Controller('billing/console')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
export class BillingOperationsController {
  constructor(
    private readonly operations: BillingOperationsService,
    private readonly subscriptionsManagement: BillingSubscriptionsManagementService,
  ) {}

  @Get('subscriptions')
  @Permissions('billing.subscriptions.read')
  listSubscriptions(
    @Query() query: ListConsoleSubscriptionsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.listSubscriptions(
      query,
      request.billingOrganizationScope!,
    );
  }

  @Get('subscriptions/:id')
  @Permissions('billing.subscriptions.read')
  @BillingResource('subscriptions', 'id')
  getSubscription(@Param('id', ParseUUIDPipe) id: string) {
    return this.operations.getSubscription(id);
  }

  @Get('checkouts')
  @Permissions('billing.checkout.read')
  listCheckouts(
    @Query() query: ListConsoleCheckoutsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.listCheckouts(
      query,
      request.billingOrganizationScope!,
    );
  }

  @Get('checkouts/:id')
  @Permissions('billing.checkout.read')
  @BillingResource('checkout_sessions', 'id')
  getCheckout(@Param('id', ParseUUIDPipe) id: string) {
    return this.operations.getCheckout(id);
  }

  @Post('checkouts/:id/verify')
  @Permissions('billing.checkout.verify')
  @BillingResource('checkout_sessions', 'id')
  verifyCheckout(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.subscriptionsManagement.verifyCheckoutSession(
      id,
      request.principal!.sub,
    );
  }

  @Get('licenses')
  @Permissions('billing.licenses.read')
  listLicenses(
    @Query() query: ListConsoleLicensesQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.listLicenses(
      query,
      request.billingOrganizationScope!,
    );
  }

  @Get('licenses/:id')
  @Permissions('billing.licenses.read')
  @BillingResource('licenses', 'id')
  getLicense(@Param('id', ParseUUIDPipe) id: string) {
    return this.operations.getLicense(id);
  }

  @Get('dashboard/summary')
  @Permissions('billing.dashboard.read')
  dashboard(@Req() request: AuthenticatedRequest) {
    return this.operations.dashboard(request.billingOrganizationScope!);
  }
}
