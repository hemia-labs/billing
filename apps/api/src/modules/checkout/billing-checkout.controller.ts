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
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingCheckoutService } from './billing-checkout.service';
import {
  CheckoutSessionResponseDto,
  CheckoutSessionStatusResponseDto,
  CreateCheckoutSessionDto,
} from './dtos';

@Controller('billing/checkout/sessions')
export class BillingCheckoutController {
  constructor(private readonly service: BillingCheckoutService) {}

  @Post()
  @UseGuards(BillingInternalAuthGuard, PermissionsGuard)
  @Permissions('billing.checkout.manage')
  create(
    @Body() dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionResponseDto> {
    return this.service.createCheckoutSession(dto);
  }

  @Get(':id/status')
  @UseGuards(BillingInternalAuthGuard, PermissionsGuard)
  @Permissions('billing.checkout.manage')
  status(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CheckoutSessionStatusResponseDto> {
    return this.service.getCheckoutStatus(id);
  }
}
