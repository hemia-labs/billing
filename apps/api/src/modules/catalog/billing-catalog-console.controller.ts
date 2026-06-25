import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingCatalogService } from './billing-catalog.service';
import {
  BillingAddonResponseDto,
  BillingPlanResponseDto,
  BillingProductResponseDto,
  CatalogPageDto,
  CreateBillingAddonDto,
  CreateBillingPlanDto,
  CreateBillingProductDto,
  ListBillingAddonsQueryDto,
  ListBillingPlansQueryDto,
  ListBillingProductsQueryDto,
  UpdateBillingAddonDto,
  UpdateBillingPlanDto,
  UpdateBillingProductDto,
} from './dtos';

@Controller('billing/console/catalog')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
export class BillingCatalogConsoleController {
  constructor(private readonly service: BillingCatalogService) {}

  @Get('products')
  @Permissions('billing.catalog.read')
  listProducts(
    @Query() query: ListBillingProductsQueryDto,
  ): Promise<CatalogPageDto<BillingProductResponseDto>> {
    return this.service.listProducts(query);
  }

  @Get('products/:id')
  @Permissions('billing.catalog.read')
  getProduct(@Param('id', ParseUUIDPipe) id: string): Promise<BillingProductResponseDto> {
    return this.service.getProduct(id);
  }

  @Post('products')
  @Permissions('billing.catalog.manage')
  createProduct(@Body() dto: CreateBillingProductDto): Promise<BillingProductResponseDto> {
    return this.service.createProduct(dto);
  }

  @Patch('products/:id')
  @Permissions('billing.catalog.manage')
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillingProductDto,
  ): Promise<BillingProductResponseDto> {
    return this.service.updateProduct(id, dto);
  }

  @Get('plans')
  @Permissions('billing.catalog.read')
  listPlans(@Query() query: ListBillingPlansQueryDto): Promise<CatalogPageDto<BillingPlanResponseDto>> {
    return this.service.listPlans(query);
  }

  @Get('plans/:id')
  @Permissions('billing.catalog.read')
  getPlan(@Param('id', ParseUUIDPipe) id: string): Promise<BillingPlanResponseDto> {
    return this.service.getPlan(id);
  }

  @Post('plans')
  @Permissions('billing.catalog.manage')
  createPlan(@Body() dto: CreateBillingPlanDto): Promise<BillingPlanResponseDto> {
    return this.service.createPlan(dto);
  }

  @Patch('plans/:id')
  @Permissions('billing.catalog.manage')
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillingPlanDto,
  ): Promise<BillingPlanResponseDto> {
    return this.service.updatePlan(id, dto);
  }

  @Get('addons')
  @Permissions('billing.catalog.read')
  listAddons(@Query() query: ListBillingAddonsQueryDto): Promise<CatalogPageDto<BillingAddonResponseDto>> {
    return this.service.listAddons(query);
  }

  @Get('addons/:id')
  @Permissions('billing.catalog.read')
  getAddon(@Param('id', ParseUUIDPipe) id: string): Promise<BillingAddonResponseDto> {
    return this.service.getAddon(id);
  }

  @Post('addons')
  @Permissions('billing.catalog.manage')
  createAddon(@Body() dto: CreateBillingAddonDto): Promise<BillingAddonResponseDto> {
    return this.service.createAddon(dto);
  }

  @Patch('addons/:id')
  @Permissions('billing.catalog.manage')
  updateAddon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillingAddonDto,
  ): Promise<BillingAddonResponseDto> {
    return this.service.updateAddon(id, dto);
  }
}
