import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { BillingServiceAccess } from '../../../common/decorators/billing-service-access.decorator';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request.type';
import { billingServiceAuthorization } from '../../../common/types/billing-service-authorization.type';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { BillingInternalAuthGuard } from '../../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { BillingCatalogService } from '../billing-catalog.service';
import {
  BillingActiveProductResponseDto,
  BillingAddonResponseDto,
  CatalogProductQueryDto,
  PublicCatalogPlansResponseDto,
  PublicPaypalPlanQueryDto,
  PublicPaypalPlanResponseDto,
} from '../dtos';

@Controller('billing/catalog')
export class BillingCatalogPublicController {
  constructor(private readonly service: BillingCatalogService) {}

  @Get('products')
  @BillingServiceAccess('catalog')
  @UseGuards(BillingInternalAuthGuard, PermissionsGuard)
  @Permissions('billing.integration.catalog.read')
  listProducts(
    @Req() request: AuthenticatedRequest,
  ): Promise<BillingActiveProductResponseDto[]> {
    return this.service.listActiveProducts(
      billingServiceAuthorization(request).policy.products,
    );
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
