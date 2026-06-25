import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import {
  BillingAddonEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import {
  AddonStatus,
  BillingAddonPricingModel,
  BillingPlanStatus,
  BillingProductStatus,
  SubscriptionAddonStatus,
  SubscriptionStatus,
} from '../billing-shared';
import type { AddonEntitlementEffects } from '../billing-shared';
import {
  BillingActiveProductResponseDto,
  BillingAddonResponseDto,
  CatalogPageDto,
  ListBillingAddonsQueryDto,
  ListBillingPlansQueryDto,
  ListBillingProductsQueryDto,
  BillingPlanResponseDto,
  BillingProductResponseDto,
  CreateBillingAddonDto,
  CreateBillingPlanDto,
  CreateBillingProductDto,
  UpdateBillingAddonDto,
  UpdateBillingPlanDto,
  UpdateBillingProductDto,
} from './dtos';
import { BillingCatalogMapper } from './mappers';

@Injectable()
export class BillingCatalogService {
  constructor(
    @InjectRepository(BillingProductEntity)
    private readonly products: Repository<BillingProductEntity>,
    @InjectRepository(BillingPlanEntity)
    private readonly plans: Repository<BillingPlanEntity>,
    @InjectRepository(BillingAddonEntity)
    private readonly addons: Repository<BillingAddonEntity>,
    @InjectRepository(BillingSubscriptionEntity)
    private readonly subscriptions: Repository<BillingSubscriptionEntity>,
    @InjectRepository(BillingSubscriptionAddonEntity)
    private readonly subscriptionAddons: Repository<BillingSubscriptionAddonEntity>,
  ) {}

  async listActiveProducts(): Promise<BillingActiveProductResponseDto[]> {
    const products = await this.products.find({
      where: { status: BillingProductStatus.Active },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    return products.map(BillingCatalogMapper.toActiveProductDto);
  }

  async listProducts(
    query: ListBillingProductsQueryDto,
  ): Promise<CatalogPageDto<BillingProductResponseDto>> {
    const where: FindOptionsWhere<BillingProductEntity> = {};
    if (query.status) where.status = query.status;
    const [items, total] = await this.products.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return this.page(items.map(BillingCatalogMapper.toProductDto), total, query);
  }

  async listPlans(
    query: ListBillingPlansQueryDto,
  ): Promise<CatalogPageDto<BillingPlanResponseDto>> {
    const where: FindOptionsWhere<BillingPlanEntity> = {};
    if (query.product_id) where.productId = query.product_id;
    if (query.status) where.status = query.status;
    if (query.provider) where.provider = query.provider;
    if (query.currency) where.currency = query.currency;
    if (query.billing_interval) where.billingInterval = query.billing_interval;
    const [items, total] = await this.plans.findAndCount({
      where,
      relations: { product: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return this.page(items.map(BillingCatalogMapper.toPlanDto), total, query);
  }

  async listAddons(
    query: ListBillingAddonsQueryDto,
  ): Promise<CatalogPageDto<BillingAddonResponseDto>> {
    const where: FindOptionsWhere<BillingAddonEntity> = {};
    if (query.product_id) where.productId = query.product_id;
    if (query.status) where.status = query.status;
    if (query.provider) where.provider = query.provider;
    if (query.currency) where.currency = query.currency;
    if (query.billing_interval) where.billingInterval = query.billing_interval;
    const [items, total] = await this.addons.findAndCount({
      where,
      relations: { product: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return this.page(items.map(BillingCatalogMapper.toAddonDto), total, query);
  }

  async getProduct(id: string): Promise<BillingProductResponseDto> {
    return BillingCatalogMapper.toProductDto(await this.findProductById(id));
  }

  async getPlan(id: string): Promise<BillingPlanResponseDto> {
    return BillingCatalogMapper.toPlanDto(await this.findPlanById(id));
  }

  async getAddon(id: string): Promise<BillingAddonResponseDto> {
    return BillingCatalogMapper.toAddonDto(await this.findAddonById(id));
  }

  async listActivePlansByProduct(
    productCode: string,
  ): Promise<BillingPlanResponseDto[]> {
    const product = await this.findActiveProductByCode(productCode);
    const plans = await this.plans.find({
      where: {
        productId: product.id,
        status: BillingPlanStatus.Active,
      },
      relations: { product: true },
      order: { amount: 'ASC' },
    });

    return plans.map(BillingCatalogMapper.toPlanDto);
  }

  async listActiveAddonsByProduct(
    productCode: string,
  ): Promise<BillingAddonResponseDto[]> {
    const product = await this.findActiveProductByCode(productCode);
    const addons = await this.addons.find({
      where: {
        productId: product.id,
        productCode: product.code,
        status: AddonStatus.Active,
      },
      order: { unitPrice: 'ASC' },
    });

    return addons.map(BillingCatalogMapper.toAddonDto);
  }

  async createProduct(
    dto: CreateBillingProductDto,
  ): Promise<BillingProductResponseDto> {
    await this.ensureProductCodeAvailable(dto.code);

    const product = this.products.create({
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      status: dto.status ?? BillingProductStatus.Active,
    });

    return BillingCatalogMapper.toProductDto(await this.products.save(product));
  }

  async updateProduct(
    id: string,
    dto: UpdateBillingProductDto,
  ): Promise<BillingProductResponseDto> {
    const product = await this.findProductById(id);

    if (dto.code && dto.code !== product.code) {
      await this.ensureProductCodeAvailable(dto.code);
      product.code = dto.code;
    }

    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.status !== undefined) product.status = dto.status;

    return BillingCatalogMapper.toProductDto(await this.products.save(product));
  }

  async createPlan(dto: CreateBillingPlanDto): Promise<BillingPlanResponseDto> {
    const product = await this.resolveProduct(dto.productId, dto.productCode);
    await this.ensurePlanCodeAvailable(product.id, dto.code);

    const plan = this.plans.create({
      productId: product.id,
      product,
      code: dto.code,
      provider: dto.provider,
      providerPlanId: dto.providerPlanId ?? null,
      name: dto.name,
      billingInterval: dto.billingInterval,
      currency: dto.currency,
      amount: dto.amount,
      seatsIncluded: dto.seatsIncluded,
      featuresJson: dto.featuresJson ?? {},
      status: dto.status ?? BillingPlanStatus.Active,
    });

    return BillingCatalogMapper.toPlanDto(await this.plans.save(plan));
  }

  async updatePlan(
    id: string,
    dto: UpdateBillingPlanDto,
  ): Promise<BillingPlanResponseDto> {
    const plan = await this.findPlanById(id);
    if (this.changesPlanCommercialTerms(plan, dto)) {
      await this.ensurePlanHasNoLiveContracts(plan.id);
    }
    const product =
      dto.productId || dto.productCode
        ? await this.resolveProduct(dto.productId, dto.productCode)
        : plan.product;

    if (!product) {
      throw new NotFoundException('Billing product not found');
    }

    if (
      (dto.code && dto.code !== plan.code) ||
      product.id !== plan.productId
    ) {
      await this.ensurePlanCodeAvailable(product.id, dto.code ?? plan.code, id);
    }

    plan.productId = product.id;
    plan.product = product;
    if (dto.code !== undefined) plan.code = dto.code;
    if (dto.provider !== undefined) plan.provider = dto.provider;
    if (dto.providerPlanId !== undefined) {
      plan.providerPlanId = dto.providerPlanId;
    }
    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.billingInterval !== undefined) {
      plan.billingInterval = dto.billingInterval;
    }
    if (dto.currency !== undefined) plan.currency = dto.currency;
    if (dto.amount !== undefined) plan.amount = dto.amount;
    if (dto.seatsIncluded !== undefined) {
      plan.seatsIncluded = dto.seatsIncluded;
    }
    if (dto.featuresJson !== undefined) plan.featuresJson = dto.featuresJson;
    if (dto.status !== undefined) plan.status = dto.status;

    return BillingCatalogMapper.toPlanDto(await this.plans.save(plan));
  }

  async createAddon(
    dto: CreateBillingAddonDto,
  ): Promise<BillingAddonResponseDto> {
    const product = await this.resolveProduct(dto.productId, dto.productCode);
    await this.ensureAddonCodeAvailable(product.code, dto.code);

    const addon = this.addons.create({
      productId: product.id,
      product,
      productCode: product.code,
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      unitPrice: dto.unitPrice,
      currency: dto.currency,
      billingInterval: dto.billingInterval,
      type: dto.type,
      pricingModel: dto.pricingModel,
      minQuantity:
        dto.pricingModel === BillingAddonPricingModel.Flat
          ? 1
          : (dto.minQuantity ?? 1),
      maxQuantity:
        dto.pricingModel === BillingAddonPricingModel.Flat
          ? 1
          : (dto.maxQuantity ?? null),
      provider: dto.provider,
      providerPlanId: dto.providerPlanId ?? null,
      entitlementEffects: this.normalizeEntitlementEffects(dto.entitlementEffects),
      status: dto.status ?? AddonStatus.Active,
      metadata: dto.metadata ?? {},
    });

    this.validateAddonPricing(addon);

    return BillingCatalogMapper.toAddonDto(await this.addons.save(addon));
  }

  async updateAddon(
    id: string,
    dto: UpdateBillingAddonDto,
  ): Promise<BillingAddonResponseDto> {
    const addon = await this.findAddonById(id);
    if (this.changesAddonCommercialTerms(addon, dto)) {
      await this.ensureAddonHasNoLiveContracts(addon.id);
    }
    const product =
      dto.productId || dto.productCode
        ? await this.resolveProduct(dto.productId, dto.productCode)
        : addon.product;

    if (!product) {
      throw new NotFoundException('Billing product not found');
    }

    if (
      (dto.code && dto.code !== addon.code) ||
      product.code !== addon.productCode
    ) {
      await this.ensureAddonCodeAvailable(
        product.code,
        dto.code ?? addon.code,
        id,
      );
    }

    addon.productId = product.id;
    addon.product = product;
    addon.productCode = product.code;
    if (dto.code !== undefined) addon.code = dto.code;
    if (dto.name !== undefined) addon.name = dto.name;
    if (dto.description !== undefined) addon.description = dto.description;
    if (dto.unitPrice !== undefined) addon.unitPrice = dto.unitPrice;
    if (dto.currency !== undefined) addon.currency = dto.currency;
    if (dto.billingInterval !== undefined) {
      addon.billingInterval = dto.billingInterval;
    }
    if (dto.type !== undefined) addon.type = dto.type;
    if (dto.pricingModel !== undefined) addon.pricingModel = dto.pricingModel;
    if (dto.minQuantity !== undefined) addon.minQuantity = dto.minQuantity;
    if (dto.maxQuantity !== undefined) addon.maxQuantity = dto.maxQuantity;
    if (dto.provider !== undefined) addon.provider = dto.provider;
    if (dto.providerPlanId !== undefined) {
      addon.providerPlanId = dto.providerPlanId;
    }
    if (dto.entitlementEffects !== undefined) {
      addon.entitlementEffects = this.normalizeEntitlementEffects(
        dto.entitlementEffects,
      );
    }
    if (dto.status !== undefined) addon.status = dto.status;
    if (dto.metadata !== undefined) addon.metadata = dto.metadata;

    if (addon.pricingModel === BillingAddonPricingModel.Flat) {
      addon.minQuantity = 1;
      addon.maxQuantity = 1;
    }

    this.validateAddonPricing(addon);

    return BillingCatalogMapper.toAddonDto(await this.addons.save(addon));
  }

  private async resolveProduct(
    productId?: string,
    productCode?: string,
  ): Promise<BillingProductEntity> {
    if (!productId && !productCode) {
      throw new BadRequestException('productId or productCode is required');
    }

    const product = productId
      ? await this.products.findOne({ where: { id: productId } })
      : await this.products.findOne({ where: { code: productCode } });

    if (!product) {
      throw new NotFoundException('Billing product not found');
    }

    return product;
  }

  private page<T>(
    items: T[],
    total: number,
    query: { page: number; limit: number },
  ): CatalogPageDto<T> {
    return { items, total, page: query.page, limit: query.limit };
  }

  private changesPlanCommercialTerms(
    plan: BillingPlanEntity,
    dto: UpdateBillingPlanDto,
  ): boolean {
    return (
      (dto.amount !== undefined && dto.amount !== plan.amount) ||
      (dto.billingInterval !== undefined &&
        dto.billingInterval !== plan.billingInterval) ||
      (dto.currency !== undefined && dto.currency !== plan.currency) ||
      (dto.provider !== undefined && dto.provider !== plan.provider) ||
      (dto.providerPlanId !== undefined &&
        dto.providerPlanId !== plan.providerPlanId)
    );
  }

  private changesAddonCommercialTerms(
    addon: BillingAddonEntity,
    dto: UpdateBillingAddonDto,
  ): boolean {
    return (
      (dto.unitPrice !== undefined && dto.unitPrice !== addon.unitPrice) ||
      (dto.billingInterval !== undefined &&
        dto.billingInterval !== addon.billingInterval) ||
      (dto.currency !== undefined && dto.currency !== addon.currency) ||
      (dto.provider !== undefined && dto.provider !== addon.provider) ||
      (dto.providerPlanId !== undefined &&
        dto.providerPlanId !== addon.providerPlanId)
    );
  }

  private async ensurePlanHasNoLiveContracts(planId: string): Promise<void> {
    const subscription = await this.subscriptions.findOne({
      where: {
        planId,
        status: In([
          SubscriptionStatus.Pending,
          SubscriptionStatus.Active,
          SubscriptionStatus.PastDue,
          SubscriptionStatus.Suspended,
        ]),
      },
    });

    if (subscription) {
      throw new ConflictException('Billing plan has live subscriptions');
    }
  }

  private async ensureAddonHasNoLiveContracts(addonId: string): Promise<void> {
    const subscriptionAddon = await this.subscriptionAddons.findOne({
      where: {
        addonId,
        status: In([
          SubscriptionAddonStatus.PendingPayment,
          SubscriptionAddonStatus.Active,
          SubscriptionAddonStatus.ScheduledCancel,
        ]),
      },
    });

    if (subscriptionAddon) {
      throw new ConflictException('Billing add-on has live subscriptions');
    }
  }

  private async findActiveProductByCode(
    code: string,
  ): Promise<BillingProductEntity> {
    const product = await this.products.findOne({
      where: { code, status: BillingProductStatus.Active },
    });

    if (!product) {
      throw new NotFoundException('Billing product not found');
    }

    return product;
  }

  private async findProductById(id: string): Promise<BillingProductEntity> {
    const product = await this.products.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Billing product not found');
    return product;
  }

  private async findPlanById(id: string): Promise<BillingPlanEntity> {
    const plan = await this.plans.findOne({
      where: { id },
      relations: { product: true },
    });
    if (!plan) throw new NotFoundException('Billing plan not found');
    return plan;
  }

  private async findAddonById(id: string): Promise<BillingAddonEntity> {
    const addon = await this.addons.findOne({
      where: { id },
      relations: { product: true },
    });
    if (!addon) throw new NotFoundException('Billing addon not found');
    return addon;
  }

  private async ensureProductCodeAvailable(code: string): Promise<void> {
    const existing = await this.products.findOne({ where: { code } });
    if (existing) throw new ConflictException('Billing product code exists');
  }

  private async ensurePlanCodeAvailable(
    productId: string,
    code: string,
    ignoreId?: string,
  ): Promise<void> {
    const existing = await this.plans.findOne({ where: { productId, code } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('Billing plan code exists');
    }
  }

  private async ensureAddonCodeAvailable(
    productCode: string,
    code: string,
    ignoreId?: string,
  ): Promise<void> {
    const existing = await this.addons.findOne({
      where: { productCode, code },
    });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('Billing addon code exists');
    }
  }

  private validateAddonPricing(addon: BillingAddonEntity): void {
    if (
      addon.maxQuantity !== null &&
      addon.maxQuantity < addon.minQuantity
    ) {
      throw new BadRequestException('maxQuantity cannot be less than minQuantity');
    }

    if (
      addon.pricingModel === BillingAddonPricingModel.Flat &&
      (addon.minQuantity !== 1 || addon.maxQuantity !== 1)
    ) {
      throw new BadRequestException('Flat add-ons require quantity 1');
    }
  }

  private normalizeEntitlementEffects(
    value: AddonEntitlementEffects,
  ): AddonEntitlementEffects {
    const numeric = value?.numeric ?? {};
    const features = value?.features ?? {};

    if (
      !this.isRecord(numeric) ||
      !Object.values(numeric).every(
        (item) => typeof item === 'number' && Number.isFinite(item) && item >= 0,
      )
    ) {
      throw new BadRequestException('Invalid numeric entitlement effects');
    }

    if (
      !this.isRecord(features) ||
      !Object.values(features).every((item) => typeof item === 'boolean')
    ) {
      throw new BadRequestException('Invalid feature entitlement effects');
    }

    return { numeric, features };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
