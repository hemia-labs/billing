import {
  BillingAddonEntity,
  BillingPlanEntity,
  BillingProductEntity,
} from '../../billing-shared';
import {
  BillingAddonResponseDto,
  BillingPlanResponseDto,
  BillingProductResponseDto,
} from '../dtos';

export class BillingCatalogMapper {
  static toProductDto(entity: BillingProductEntity): BillingProductResponseDto {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      status: entity.status,
    };
  }

  static toPlanDto(entity: BillingPlanEntity): BillingPlanResponseDto {
    return {
      id: entity.id,
      productId: entity.productId,
      productCode: entity.product?.code,
      code: entity.code,
      provider: entity.provider,
      providerPlanId: entity.providerPlanId,
      name: entity.name,
      billingInterval: entity.billingInterval,
      currency: entity.currency,
      amount: entity.amount,
      seatsIncluded: entity.seatsIncluded,
      featuresJson: entity.featuresJson,
      status: entity.status,
    };
  }

  static toAddonDto(entity: BillingAddonEntity): BillingAddonResponseDto {
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
      status: entity.status,
      metadata: entity.metadata,
    };
  }
}
