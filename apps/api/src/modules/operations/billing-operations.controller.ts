import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  SetMetadata,
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
  listSubscriptions(@Query() query: ListConsoleSubscriptionsQueryDto) {
    return this.operations.listSubscriptions(query);
  }

  @Get('subscriptions/:id')
  @Permissions('billing.subscriptions.read')
  getSubscription(@Param('id', ParseUUIDPipe) id: string) {
    return this.operations.getSubscription(id);
  }

  @Get('checkouts')
  @Permissions('billing.subscriptions.read')
  listCheckouts(@Query() query: ListConsoleCheckoutsQueryDto) {
    return this.operations.listCheckouts(query);
  }

  @Get('checkouts/:id')
  @Permissions('billing.subscriptions.read')
  getCheckout(@Param('id', ParseUUIDPipe) id: string) {
    return this.operations.getCheckout(id);
  }

  @Post('checkouts/:id/verify')
  @Permissions('billing.subscriptions.manage')
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
  listLicenses(@Query() query: ListConsoleLicensesQueryDto) {
    return this.operations.listLicenses(query);
  }

  @Get('licenses/:id')
  @Permissions('billing.licenses.read')
  getLicense(@Param('id', ParseUUIDPipe) id: string) {
    return this.operations.getLicense(id);
  }

  @Get('dashboard/summary')
  @SetMetadata('billing:console:skip-auth', true)
  dashboard() {
    return this.operations.dashboard();
  }
}
