import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import { billingServiceActor } from '../../common/types/billing-service-authorization.type';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { BillingPaymentAttemptsService } from './billing-payment-attempts.service';
import {
  CreatePaymentAttemptDto,
  PaymentAttemptContextDto,
} from './payment-attempt.dto';

@Controller('billing/integrations/v1/payment-attempts')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
export class BillingPaymentAttemptsController {
  constructor(private readonly attempts: BillingPaymentAttemptsService) {}
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permissions('billing.integration.checkout.create')
  @BillingServiceAccess({
    product: 'productCode',
    organization: 'organizationId',
    source: 'body',
  })
  create(
    @Body() dto: CreatePaymentAttemptDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attempts.create(
      dto,
      billingServiceActor(request),
      request.principal?.permissions ?? request.principal?.scopes ?? [],
    );
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @Permissions('billing.integration.checkout.read')
  @BillingServiceAccess({
    product: 'productCode',
    organization: 'organizationId',
    source: 'query',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() context: PaymentAttemptContextDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attempts.get(id, context, billingServiceActor(request));
  }
  @Post(':id/retry')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permissions('billing.integration.checkout.create')
  @BillingServiceAccess({
    product: 'productCode',
    organization: 'organizationId',
    source: 'query',
  })
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() context: PaymentAttemptContextDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attempts.retry(
      id,
      context,
      billingServiceActor(request),
      request.principal?.permissions ?? request.principal?.scopes ?? [],
    );
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permissions('billing.subscriptions.manage')
  @BillingServiceAccess({
    product: 'productCode',
    organization: 'organizationId',
    source: 'query',
  })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() context: PaymentAttemptContextDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attempts.cancel(id, context, billingServiceActor(request));
  }
  @Post(':id/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permissions('billing.subscriptions.manage')
  @BillingServiceAccess({
    product: 'productCode',
    organization: 'organizationId',
    source: 'query',
  })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() context: PaymentAttemptContextDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attempts.confirm(id, context, billingServiceActor(request));
  }
}
