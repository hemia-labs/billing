import { BillingSubscriptionAddonEntity } from '../../billing-shared';
import {
  SubscriptionAddonResponseDto,
  SubscriptionAddonSummaryResponseDto,
} from '../dtos';

export class SubscriptionAddonMapper {
  static toDto(
    entity: BillingSubscriptionAddonEntity,
  ): SubscriptionAddonResponseDto {
    return {
      id: entity.id,
      subscriptionId: entity.subscriptionId,
      addonId: entity.addonId,
      addonCode: entity.addonCode,
      quantity: entity.quantity,
      status: entity.status,
      unitPrice: entity.unitPrice,
      currency: entity.currency,
      billingInterval: entity.billingInterval,
      pricingModel: entity.pricingModel,
      entitlementEffects: entity.entitlementEffects,
      provider: entity.provider,
      providerReferenceId: entity.providerReferenceId,
      pendingEffectiveAt: entity.pendingEffectiveAt,
      currentPeriodEnd: entity.currentPeriodEnd,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  static toSummary(input: {
    subscriptionId: string;
    planCode: string;
    baseAmount: string;
    addonsAmount: string;
    totalAmount: string;
    currency: SubscriptionAddonSummaryResponseDto['currency'];
    addons: BillingSubscriptionAddonEntity[];
  }): SubscriptionAddonSummaryResponseDto {
    return {
      subscriptionId: input.subscriptionId,
      planCode: input.planCode,
      baseAmount: input.baseAmount,
      addonsAmount: input.addonsAmount,
      totalAmount: input.totalAmount,
      currency: input.currency,
      addons: input.addons.map((addon) => this.toDto(addon)),
    };
  }
}
