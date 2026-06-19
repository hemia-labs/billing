import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingLicensesService } from './billing-licenses.service';
import {
  BillingLicenseResolveResponseDto,
  ResolveBillingLicenseQueryDto,
} from './dtos';

@Controller('billing/licenses')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
@Permissions('billing.licenses.read')
export class BillingLicensesController {
  constructor(private readonly service: BillingLicensesService) {}

  @Get('resolve')
  resolve(
    @Query() query: ResolveBillingLicenseQueryDto,
  ): Promise<BillingLicenseResolveResponseDto> {
    return this.service.resolveLicense(
      query.organization_id,
      query.product_code,
    );
  }
}
