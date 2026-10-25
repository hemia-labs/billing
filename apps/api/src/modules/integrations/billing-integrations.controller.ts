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
  UseFilters,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import {
  billingServiceActor,
  billingServiceAuthorization,
} from '../../common/types/billing-service-authorization.type';
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
import { CheckoutInProgressFilter } from '../checkout/filters/checkout-in-progress.filter';
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
  @BillingServiceAccess('catalog')
  listProducts(
    @Req() request: AuthenticatedRequest,
  ): Promise<BillingActiveProductResponseDto[]> {
    return this.catalog.listActiveProducts(
      billingServiceAuthorization(request).policy.products,
    );
  }

  @Get('catalog/products/:productCode/plans')
  @BillingServiceAccess({ product: 'productCode', source: 'params' })
  @Permissions('billing.integration.catalog.read')
  listPlans(
    @Param('productCode') productCode: string,
  ): Promise<BillingPlanResponseDto[]> {
    return this.catalog.listActivePlansByProduct(productCode);
  }

  @Get('catalog/products/:productCode/addons')
  @BillingServiceAccess({ product: 'productCode', source: 'params' })
  @Permissions('billing.integration.catalog.read')
  listAddons(
    @Param('productCode') productCode: string,
  ): Promise<BillingAddonResponseDto[]> {
    return this.catalog.listActiveAddonsByProduct(productCode);
  }

  @Post('checkout/sessions')
  @UseFilters(CheckoutInProgressFilter)
  @BillingServiceAccess({
    product: 'productCode',
    organization: 'organizationId',
    source: 'body',
  })
  @Permissions('billing.integration.checkout.create')
  createCheckoutSession(
    @Body() dto: CreateIntegrationCheckoutSessionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CheckoutSessionResponseDto> {
    const organizationId = resolveIntegrationOrganizationId(
      request.principal,
      dto.organizationId,
    );

    return this.checkout.createCheckoutSession(
      {
        ...dto,
        organizationId,
        userId: resolveIntegrationUserId(request.principal, dto.userId),
      },
      billingServiceActor(request),
    );
  }

  @Get('checkout/sessions/:id/status')
  @BillingServiceAccess({ resource: 'checkout_sessions' })
  @Permissions('billing.integration.checkout.read')
  getCheckoutStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CheckoutSessionStatusResponseDto> {
    return this.checkout.getCheckoutStatus(id, billingServiceActor(request));
  }

  @Get('licenses/resolve')
  @BillingServiceAccess({
    product: 'product_code',
    organization: 'organization_id',
    source: 'query',
  })
  @Permissions('billing.integration.licenses.read')
  resolveLicense(
    @Query() query: ResolveIntegrationLicenseQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BillingLicenseResolveResponseDto> {
    return this.licenses.resolveLicense(
      resolveIntegrationOrganizationId(
        request.principal,
        query.organization_id,
      ),
      query.product_code,
    );
  }
}
