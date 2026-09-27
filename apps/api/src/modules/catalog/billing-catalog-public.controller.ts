import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingCatalogService } from './billing-catalog.service';
import {
  BillingActiveProductResponseDto,
  BillingAddonResponseDto,
  CatalogProductQueryDto,
  PublicCatalogPlansResponseDto,
  PublicPaypalPlanQueryDto,
  PublicPaypalPlanResponseDto,
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
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  listPlans(
    @Query() query: CatalogProductQueryDto,
  ): Promise<PublicCatalogPlansResponseDto> {
    return this.service.listPublicPlansByProduct(query.product_code);
  }

  @Get('paypal-plan')
  @Header('Cache-Control', 'no-store')
  getPaypalPlan(
    @Query() query: PublicPaypalPlanQueryDto,
  ): Promise<PublicPaypalPlanResponseDto> {
    return this.service.getPublicPaypalPlanId(
      query.product_code,
      query.plan_code,
      query.plan_price_code,
    );
  }

  @Get('addons')
  listAddons(
    @Query() query: CatalogProductQueryDto,
  ): Promise<BillingAddonResponseDto[]> {
    return this.service.listActiveAddonsByProduct(query.product_code);
  }
}
