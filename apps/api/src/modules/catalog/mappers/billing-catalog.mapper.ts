import {
  BillingAddonEntity,
  BillingFeatureDefinitionEntity,
  BillingPlanEntitlementEntity,
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProductEntity,
  BillingProviderPriceEntity,
} from '../../billing-shared';
import {
  BillingActiveProductResponseDto,
  BillingAddonResponseDto,
  BillingFeatureDefinitionResponseDto,
  BillingPlanEntitlementResponseDto,
  BillingPlanPriceResponseDto,
  BillingPlanOverviewResponseDto,
  BillingPlanResponseDto,
  BillingPlanVersionResponseDto,
  BillingProductResponseDto,
  BillingProviderPriceResponseDto,
} from '../dtos';

export class BillingCatalogMapper {
  static toProductDto(
    this: void,
    entity: BillingProductEntity,
  ): BillingProductResponseDto {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      status: entity.status,
    };
  }

  static toActiveProductDto(
    this: void,
    entity: BillingProductEntity,
  ): BillingActiveProductResponseDto {
    return { id: entity.id, code: entity.code, name: entity.name };
  }

  static toPlanDto(
    this: void,
    entity: BillingPlanEntity,
  ): BillingPlanResponseDto {
    return {
      ...BillingCatalogMapper.toPlanOverviewDto(entity),
      versions: (entity.versions ?? []).map(
        BillingCatalogMapper.toPlanVersionDto,
      ),
    };
  }

  static toPlanOverviewDto(
    this: void,
    entity: BillingPlanEntity,
  ): BillingPlanOverviewResponseDto {
    return {
      id: entity.id,
      productId: entity.productId,
      productCode: entity.product?.code,
      product: entity.product
        ? BillingCatalogMapper.toProductDto(entity.product)
        : undefined,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      status: entity.status,
    };
  }

  static toPlanVersionDto(
    this: void,
    entity: BillingPlanVersionEntity,
  ): BillingPlanVersionResponseDto {
    return {
      id: entity.id,
      version: entity.version,
      status: entity.status,
      effectiveFrom: entity.effectiveFrom,
      effectiveUntil: entity.effectiveUntil,
      prices: (entity.prices ?? []).map(BillingCatalogMapper.toPlanPriceDto),
      entitlements: (entity.entitlements ?? []).map(
        BillingCatalogMapper.toPlanEntitlementDto,
      ),
    };
  }

  static toPlanPriceDto(
    this: void,
    entity: BillingPlanPriceEntity,
  ): BillingPlanPriceResponseDto {
    return {
      id: entity.id,
      code: entity.code,
      billingInterval: entity.billingInterval,
      billingIntervalCount: entity.billingIntervalCount,
      currency: entity.currency,
      amount: entity.amount,
      status: entity.status,
      providerPrices: (entity.providerPrices ?? []).map(
        BillingCatalogMapper.toProviderPriceDto,
      ),
    };
  }

  static toProviderPriceDto(
    this: void,
    entity: BillingProviderPriceEntity,
  ): BillingProviderPriceResponseDto {
    return {
      id: entity.id,
      provider: entity.provider,
      providerProductId: entity.providerProductId,
      providerPriceId: entity.providerPriceId,
      providerMetadata: entity.providerMetadata,
      status: entity.status,
    };
  }

  static toFeatureDefinitionDto(
    this: void,
    entity: BillingFeatureDefinitionEntity,
  ): BillingFeatureDefinitionResponseDto {
    return {
      id: entity.id,
      productId: entity.productId,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      valueType: entity.valueType,
      unit: entity.unit,
      aggregationStrategy: entity.aggregationStrategy,
      isMetered: entity.isMetered,
      status: entity.status,
    };
  }

  static toPlanEntitlementDto(
    this: void,
    entity: BillingPlanEntitlementEntity,
  ): BillingPlanEntitlementResponseDto {
    return {
      id: entity.id,
      feature: BillingCatalogMapper.toFeatureDefinitionDto(entity.feature),
      valueJson: entity.valueJson,
    };
  }

  static toAddonDto(
    this: void,
    entity: BillingAddonEntity,
  ): BillingAddonResponseDto {
    return {
      id: entity.id,
      productId: entity.productId,
      productCode: entity.productCode,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      unitPrice: entity.unitPrice,
      currency: entity.currency,
      billingInterval: entity.billingInterval,
      type: entity.type,
      pricingModel: entity.pricingModel,
      minQuantity: entity.minQuantity,
      maxQuantity: entity.maxQuantity,
      provider: entity.provider,
      providerPlanId: entity.providerPlanId,
      entitlementEffects: entity.entitlementEffects,
      status: entity.status,
    };
  }
}
