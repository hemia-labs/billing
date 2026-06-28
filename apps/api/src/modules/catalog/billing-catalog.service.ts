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
  BillingFeatureDefinitionEntity,
  BillingPlanEntitlementEntity,
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProductEntity,
  BillingProviderPriceEntity,
  BillingSubscriptionAddonEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import {
  AddonStatus,
  BillingAddonPricingModel,
  BillingPlanStatus,
  BillingProductStatus,
  FeatureAggregationStrategy,
  FeatureDefinitionStatus,
  PlanPriceStatus,
  PlanVersionStatus,
  ProviderPriceStatus,
  SubscriptionAddonStatus,
  SubscriptionStatus,
} from '../billing-shared';
import type { AddonEntitlementEffects } from '../billing-shared';
import {
  BillingActiveProductResponseDto,
  BillingAddonResponseDto,
  BillingFeatureDefinitionResponseDto,
  CatalogPageDto,
  ListBillingAddonsQueryDto,
  ListBillingPlansQueryDto,
  ListBillingProductsQueryDto,
  BillingPlanResponseDto,
  BillingProductResponseDto,
  CreateFeatureDefinitionDto,
  CreateBillingAddonDto,
  CreateBillingPlanDto,
  CreateBillingProductDto,
  CreatePlanEntitlementDto,
  CreatePlanVersionDto,
  UpdateBillingAddonDto,
  UpdateBillingPlanDto,
  UpdateBillingProductDto,
} from './dtos';
import { BillingPlanCatalogResolver } from './billing-plan-catalog.resolver';
import { BillingCatalogMapper } from './mappers';

@Injectable()
export class BillingCatalogService {
  constructor(
    @InjectRepository(BillingProductEntity)
    private readonly products: Repository<BillingProductEntity>,
    @InjectRepository(BillingPlanEntity)
    private readonly plans: Repository<BillingPlanEntity>,
    @InjectRepository(BillingPlanVersionEntity)
    private readonly planVersions: Repository<BillingPlanVersionEntity>,
    @InjectRepository(BillingPlanPriceEntity)
    private readonly planPrices: Repository<BillingPlanPriceEntity>,
    @InjectRepository(BillingProviderPriceEntity)
    private readonly providerPrices: Repository<BillingProviderPriceEntity>,
    @InjectRepository(BillingFeatureDefinitionEntity)
    private readonly featureDefinitions: Repository<BillingFeatureDefinitionEntity>,
    @InjectRepository(BillingPlanEntitlementEntity)
    private readonly planEntitlements: Repository<BillingPlanEntitlementEntity>,
    @InjectRepository(BillingAddonEntity)
    private readonly addons: Repository<BillingAddonEntity>,
    @InjectRepository(BillingSubscriptionEntity)
    private readonly subscriptions: Repository<BillingSubscriptionEntity>,
    @InjectRepository(BillingSubscriptionAddonEntity)
    private readonly subscriptionAddons: Repository<BillingSubscriptionAddonEntity>,
    private readonly planResolver: BillingPlanCatalogResolver,
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
    const plans = await this.plans.find({
      where,
      relations: this.planRelations(),
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const items = plans.filter((plan) => this.matchesPlanFilters(plan, query));
    const start = (query.page - 1) * query.limit;

    return this.page(
      items.slice(start, start + query.limit).map(BillingCatalogMapper.toPlanDto),
      items.length,
      query,
    );
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
      relations: this.planRelations(),
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    return plans
      .filter((plan) => this.hasPublishedPrice(plan))
      .sort(
        (left, right) =>
          Number(this.planResolver.activePrice(this.planResolver.publishedVersion(left)).amount) -
          Number(this.planResolver.activePrice(this.planResolver.publishedVersion(right)).amount),
      )
      .map(BillingCatalogMapper.toPlanDto);
  }

  async listFeatures(
    query: ListBillingProductsQueryDto,
  ): Promise<CatalogPageDto<BillingFeatureDefinitionResponseDto>> {
    const [items, total] = await this.featureDefinitions.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return this.page(
      items.map(BillingCatalogMapper.toFeatureDefinitionDto),
      total,
      query,
    );
  }

  async createFeature(
    dto: CreateFeatureDefinitionDto & { productId?: string; productCode?: string },
  ): Promise<BillingFeatureDefinitionResponseDto> {
    const product = await this.resolveProduct(dto.productId, dto.productCode);
    await this.upsertFeatureDefinitions(product.id, [dto]);
    const feature = await this.featureDefinitions.findOne({
      where: { productId: product.id, code: dto.code },
    });
    if (!feature) throw new NotFoundException('Billing feature definition not found');
    return BillingCatalogMapper.toFeatureDefinitionDto(feature);
  }

  async updateFeature(
    id: string,
    dto: Partial<CreateFeatureDefinitionDto>,
  ): Promise<BillingFeatureDefinitionResponseDto> {
    const feature = await this.featureDefinitions.findOne({ where: { id } });
    if (!feature) throw new NotFoundException('Billing feature definition not found');
    if (dto.name !== undefined) feature.name = dto.name;
    if (dto.description !== undefined) feature.description = dto.description;
    if (dto.valueType !== undefined) feature.valueType = dto.valueType;
    if (dto.unit !== undefined) feature.unit = dto.unit;
    if (dto.aggregationStrategy !== undefined) feature.aggregationStrategy = dto.aggregationStrategy;
    if (dto.isMetered !== undefined) feature.isMetered = dto.isMetered;
    return BillingCatalogMapper.toFeatureDefinitionDto(await this.featureDefinitions.save(feature));
  }

  async listPlanVersions(id: string) {
    const plan = await this.findPlanById(id);
    return (plan.versions ?? []).map(BillingCatalogMapper.toPlanVersionDto);
  }

  async createVersion(id: string, dto: CreatePlanVersionDto) {
    const plan = await this.findPlanById(id);
    await this.createPlanVersion(plan, dto, []);
    return this.listPlanVersions(id);
  }

  async updateVersion(id: string, dto: Partial<CreatePlanVersionDto>) {
    const version = await this.planVersions.findOne({
      where: { id },
      relations: { prices: { providerPrices: true }, entitlements: { feature: true } },
    });
    if (!version) throw new NotFoundException('Billing plan version not found');
    if (version.status !== PlanVersionStatus.Draft) {
      throw new ConflictException('Only draft plan versions can be updated');
    }
    if (dto.effectiveFrom !== undefined) {
      version.effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
    }
    if (dto.effectiveUntil !== undefined) {
      version.effectiveUntil = dto.effectiveUntil ? new Date(dto.effectiveUntil) : null;
    }
    if (dto.status !== undefined) version.status = dto.status;
    return BillingCatalogMapper.toPlanVersionDto(await this.planVersions.save(version));
  }

  async publishVersion(id: string) {
    const version = await this.planVersions.findOne({
      where: { id },
      relations: { prices: { providerPrices: true }, entitlements: { feature: true } },
    });
    if (!version) throw new NotFoundException('Billing plan version not found');

    await this.planVersions.update(
      { planId: version.planId, status: PlanVersionStatus.Published },
      { status: PlanVersionStatus.Archived },
    );
    version.status = PlanVersionStatus.Published;
    return BillingCatalogMapper.toPlanVersionDto(await this.planVersions.save(version));
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
      name: dto.name,
      description: dto.description ?? null,
      status: dto.status ?? BillingPlanStatus.Active,
    });

    const saved = await this.plans.save(plan);
    await this.createPlanVersion(saved, dto.version, dto.features ?? []);

    return BillingCatalogMapper.toPlanDto(await this.findPlanById(saved.id));
  }

  async updatePlan(
    id: string,
    dto: UpdateBillingPlanDto,
  ): Promise<BillingPlanResponseDto> {
    const plan = await this.findPlanById(id);
    if (dto.version) {
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
    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.description !== undefined) plan.description = dto.description;
    if (dto.status !== undefined) plan.status = dto.status;

    const saved = await this.plans.save(plan);
    if (dto.version) {
      await this.createPlanVersion(saved, dto.version, dto.features ?? []);
    }

    return BillingCatalogMapper.toPlanDto(await this.findPlanById(saved.id));
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
      relations: this.planRelations(),
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

  private async createPlanVersion(
    plan: BillingPlanEntity,
    dto: CreatePlanVersionDto,
    featureDtos: CreateFeatureDefinitionDto[],
  ): Promise<void> {
    await this.ensurePlanVersionAvailable(plan.id, dto.version);
    await this.upsertFeatureDefinitions(plan.productId, featureDtos);

    const version = await this.planVersions.save(
      this.planVersions.create({
        planId: plan.id,
        plan,
        version: dto.version,
        status: dto.status ?? PlanVersionStatus.Draft,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveUntil: dto.effectiveUntil ? new Date(dto.effectiveUntil) : null,
      }),
    );

    for (const priceDto of dto.prices) {
      const price = await this.planPrices.save(
        this.planPrices.create({
          planVersionId: version.id,
          planVersion: version,
          code: priceDto.code,
          billingInterval: priceDto.billingInterval,
          billingIntervalCount: priceDto.billingIntervalCount,
          currency: priceDto.currency,
          amount: priceDto.amount,
          status: priceDto.status ?? PlanPriceStatus.Active,
        }),
      );

      await Promise.all(
        priceDto.providerPrices.map((providerPrice) =>
          this.providerPrices.save(
            this.providerPrices.create({
              planPriceId: price.id,
              planPrice: price,
              provider: providerPrice.provider,
              providerProductId: providerPrice.providerProductId ?? null,
              providerPriceId: providerPrice.providerPriceId ?? null,
              providerMetadata: providerPrice.providerMetadata ?? {},
              status: providerPrice.status ?? ProviderPriceStatus.Active,
            }),
          ),
        ),
      );
    }

    await Promise.all(
      (dto.entitlements ?? []).map(async (entitlementDto) => {
        const feature = await this.resolveFeature(plan.productId, entitlementDto);
        this.planResolver.validateFeatureValue(feature.valueType, entitlementDto.valueJson);

        return this.planEntitlements.save(
          this.planEntitlements.create({
            planVersionId: version.id,
            planVersion: version,
            featureId: feature.id,
            feature,
            valueJson: entitlementDto.valueJson,
          }),
        );
      }),
    );
  }

  private async upsertFeatureDefinitions(
    productId: string,
    featureDtos: CreateFeatureDefinitionDto[],
  ): Promise<void> {
    for (const dto of featureDtos) {
      const existing = await this.featureDefinitions.findOne({
        where: { productId, code: dto.code },
      });
      const feature =
        existing ??
        this.featureDefinitions.create({
          productId,
          code: dto.code,
        });

      feature.name = dto.name;
      feature.description = dto.description ?? null;
      feature.valueType = dto.valueType;
      feature.unit = dto.unit ?? null;
      feature.aggregationStrategy =
        dto.aggregationStrategy ?? FeatureAggregationStrategy.Replace;
      feature.isMetered = dto.isMetered ?? false;
      feature.status = FeatureDefinitionStatus.Active;
      await this.featureDefinitions.save(feature);
    }
  }

  private async resolveFeature(
    productId: string,
    dto: CreatePlanEntitlementDto,
  ): Promise<BillingFeatureDefinitionEntity> {
    const feature = dto.featureId
      ? await this.featureDefinitions.findOne({ where: { id: dto.featureId, productId } })
      : dto.featureCode
        ? await this.featureDefinitions.findOne({
            where: { productId, code: dto.featureCode },
          })
        : null;

    if (!feature) throw new NotFoundException('Billing feature definition not found');
    return feature;
  }

  private async ensurePlanVersionAvailable(
    planId: string,
    version: number,
  ): Promise<void> {
    const existing = await this.planVersions.findOne({
      where: { planId, version },
    });
    if (existing) throw new ConflictException('Billing plan version exists');
  }

  private matchesPlanFilters(
    plan: BillingPlanEntity,
    query: ListBillingPlansQueryDto,
  ): boolean {
    try {
      const version = this.planResolver.publishedVersion(plan);
      const price = this.planResolver.activePrice(version);
      return (
        (!query.provider ||
          (price.providerPrices ?? []).some(
            (item) => item.provider === query.provider && item.status === ProviderPriceStatus.Active,
          )) &&
        (!query.currency || price.currency === query.currency) &&
        (!query.billing_interval ||
          this.planResolver.toLegacyInterval(price.billingInterval) === query.billing_interval)
      );
    } catch {
      return false;
    }
  }

  private hasPublishedPrice(plan: BillingPlanEntity): boolean {
    try {
      this.planResolver.activePrice(this.planResolver.publishedVersion(plan));
      return true;
    } catch {
      return false;
    }
  }

  private planRelations() {
    return {
      product: true,
      versions: {
        prices: { providerPrices: true },
        entitlements: { feature: true },
      },
    } as const;
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
