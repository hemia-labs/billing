import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingCatalogService } from './billing-catalog.service';
import {
  BillingActiveProductResponseDto,
  BillingAddonResponseDto,
  BillingPlanResponseDto,
  CatalogProductQueryDto,
} from './dtos';

@Controller('billing/catalog')
export class BillingCatalogPublicController {
  constructor(private readonly service: BillingCatalogService) {}

  @Get('products')
  @UseGuards(BillingInternalAuthGuard, PermissionsGuard)
  @Permissions('billing.integration.catalog.read')
  listProducts(): Promise<BillingActiveProductResponseDto[]> {
    return this.service.listActiveProducts();
  }

  @Get('plans')
  listPlans(
    @Query() query: CatalogProductQueryDto,
  ): Promise<BillingPlanResponseDto[]> {
    return this.service.listActivePlansByProduct(query.product_code);
  }

  @Get('addons')
  listAddons(
    @Query() query: CatalogProductQueryDto,
  ): Promise<BillingAddonResponseDto[]> {
    return this.service.listActiveAddonsByProduct(query.product_code);
  }
}
