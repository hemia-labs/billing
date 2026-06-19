import { Controller, Get, Query } from '@nestjs/common';
import { BillingCatalogService } from './billing-catalog.service';
import {
  BillingAddonResponseDto,
  BillingPlanResponseDto,
  CatalogProductQueryDto,
} from './dtos';

@Controller('billing/catalog')
export class BillingCatalogPublicController {
  constructor(private readonly service: BillingCatalogService) {}

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
