import {
  Body,
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
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { BillingCatalogService } from '../catalog';
import {
  BillingActiveProductResponseDto,
  BillingAddonResponseDto,
  BillingPlanResponseDto,
} from '../catalog/dtos';
import { BillingCheckoutService } from '../checkout';
import {
  CheckoutSessionResponseDto,
  CheckoutSessionStatusResponseDto,
} from '../checkout/dtos';
import { BillingLicensesService } from '../licenses/billing-licenses.service';
import { BillingLicenseResolveResponseDto } from '../licenses/dtos';
import {
  resolveIntegrationOrganizationId,
  resolveIntegrationUserId,
} from './billing-integration-context';
import {
  CreateIntegrationCheckoutSessionDto,
  ResolveIntegrationLicenseQueryDto,
} from './dtos';

@Controller('billing/integrations/v1')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
export class BillingIntegrationsController {
  constructor(
    private readonly catalog: BillingCatalogService,
    private readonly checkout: BillingCheckoutService,
    private readonly licenses: BillingLicensesService,
  ) {}

  @Get('catalog/products')
  @Permissions('billing.integration.catalog.read')
  listProducts(): Promise<BillingActiveProductResponseDto[]> {
    return this.catalog.listActiveProducts();
  }

  @Get('catalog/products/:productCode/plans')
  @Permissions('billing.integration.catalog.read')
  listPlans(
    @Param('productCode') productCode: string,
  ): Promise<BillingPlanResponseDto[]> {
    return this.catalog.listActivePlansByProduct(productCode);
  }

  @Get('catalog/products/:productCode/addons')
  @Permissions('billing.integration.catalog.read')
  listAddons(
    @Param('productCode') productCode: string,
  ): Promise<BillingAddonResponseDto[]> {
    return this.catalog.listActiveAddonsByProduct(productCode);
  }

  @Post('checkout/sessions')
  @Permissions('billing.integration.checkout.create')
  createCheckoutSession(
    @Body() dto: CreateIntegrationCheckoutSessionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CheckoutSessionResponseDto> {
    const organizationId = resolveIntegrationOrganizationId(
      request.principal,
      dto.organizationId,
    );

    return this.checkout.createCheckoutSession({
      ...dto,
      organizationId,
      userId: resolveIntegrationUserId(request.principal, dto.userId),
    });
  }

  @Get('checkout/sessions/:id/status')
  @Permissions('billing.integration.checkout.read')
  getCheckoutStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CheckoutSessionStatusResponseDto> {
    return this.checkout.getCheckoutStatus(id, request.principal?.organizationId);
  }

  @Get('licenses/resolve')
  @Permissions('billing.integration.licenses.read')
  resolveLicense(
    @Query() query: ResolveIntegrationLicenseQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BillingLicenseResolveResponseDto> {
    return this.licenses.resolveLicense(
      resolveIntegrationOrganizationId(request.principal, query.organization_id),
      query.product_code,
    );
  }
}
