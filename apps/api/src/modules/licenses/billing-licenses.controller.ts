import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingLicensesService } from './billing-licenses.service';
import {
  BillingLicenseResolveResponseDto,
  ResolveBillingLicenseQueryDto,
} from './dtos';

@Controller('billing/licenses')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
@Permissions('billing.integration.licenses.read')
export class BillingLicensesController {
  constructor(private readonly service: BillingLicensesService) {}

  @Get('resolve')
  @BillingServiceAccess({
    product: 'product_code',
    organization: 'organization_id',
    source: 'query',
  })
  resolve(
    @Query() query: ResolveBillingLicenseQueryDto,
  ): Promise<BillingLicenseResolveResponseDto> {
    return this.service.resolveLicense(
      query.organization_id,
      query.product_code,
    );
  }
}
