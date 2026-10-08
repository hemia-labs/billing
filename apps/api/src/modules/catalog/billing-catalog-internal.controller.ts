import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingCatalogService } from './billing-catalog.service';
import {
  BillingAddonResponseDto,
  BillingPlanResponseDto,
  BillingProductResponseDto,
  CreateBillingAddonDto,
  CreateBillingPlanDto,
  CreateBillingProductDto,
  UpdateBillingAddonDto,
  UpdateBillingPlanDto,
  UpdateBillingProductDto,
} from './dtos';

@Controller('billing')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
@Permissions('billing.catalog.manage')
export class BillingCatalogInternalController {
  constructor(private readonly service: BillingCatalogService) {}

  @Post('products')
  @BillingServiceAccess({ product: 'code', source: 'body' })
  createProduct(
    @Body() dto: CreateBillingProductDto,
  ): Promise<BillingProductResponseDto> {
    return this.service.createProduct(dto);
  }

  @Patch('products/:id')
  @BillingServiceAccess({ resource: 'products' })
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillingProductDto,
  ): Promise<BillingProductResponseDto> {
    return this.service.updateProduct(id, dto);
  }

  @Post('plans')
  @BillingServiceAccess('catalog-target')
  createPlan(
    @Body() dto: CreateBillingPlanDto,
  ): Promise<BillingPlanResponseDto> {
    return this.service.createPlan(dto);
  }

  @Patch('plans/:id')
  @BillingServiceAccess({ resource: 'plans' })
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillingPlanDto,
  ): Promise<BillingPlanResponseDto> {
    return this.service.updatePlan(id, dto);
  }

  @Post('addons')
  @BillingServiceAccess('catalog-target')
  createAddon(
    @Body() dto: CreateBillingAddonDto,
  ): Promise<BillingAddonResponseDto> {
    return this.service.createAddon(dto);
  }

  @Patch('addons/:id')
  @BillingServiceAccess({ resource: 'addons' })
  updateAddon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillingAddonDto,
  ): Promise<BillingAddonResponseDto> {
    return this.service.updateAddon(id, dto);
  }
}
