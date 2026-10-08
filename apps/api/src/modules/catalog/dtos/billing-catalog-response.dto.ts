import { BillingInterval } from '../../billing-shared';
import type {
  AddonEntitlementEffects,
  BillingCurrency,
} from '../../billing-shared';
import {
  AddonStatus,
  BillingAddonPricingModel,
  BillingAddonType,
  BillingPlanStatus,
  BillingProductStatus,
  BillingProvider,
  FeatureAggregationStrategy,
  FeatureDefinitionStatus,
  FeatureValueType,
  PlanPriceBillingInterval,
  PlanPriceStatus,
  PlanVersionStatus,
  ProviderPriceStatus,
} from '../../billing-shared';

export class BillingProductResponseDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: BillingProductStatus;
}

export class BillingActiveProductResponseDto {
  id: string;
  code: string;
  name: string;
}

export class BillingProviderPriceResponseDto {
  id: string;
  provider: BillingProvider;
  providerProductId: string | null;
  providerPriceId: string | null;
  providerMetadata: Record<string, unknown>;
  status: ProviderPriceStatus;
}

export class BillingPlanPriceResponseDto {
  id: string;
  code: string;
  billingInterval: PlanPriceBillingInterval;
  billingIntervalCount: number;
  currency: BillingCurrency;
  amount: string;
  status: PlanPriceStatus;
  providerPrices: BillingProviderPriceResponseDto[];
}

export class BillingFeatureDefinitionResponseDto {
  id: string;
  productId: string;
  code: string;
  name: string;
  description: string | null;
  valueType: FeatureValueType;
  unit: string | null;
  aggregationStrategy: FeatureAggregationStrategy;
  isMetered: boolean;
  status: FeatureDefinitionStatus;
}

export class BillingPlanEntitlementResponseDto {
  id: string;
  feature: BillingFeatureDefinitionResponseDto;
  valueJson: unknown;
}

export class BillingPlanVersionResponseDto {
  id: string;
  version: number;
  status: PlanVersionStatus;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  prices: BillingPlanPriceResponseDto[];
  entitlements: BillingPlanEntitlementResponseDto[];
}

export class BillingPlanVersionSummaryResponseDto {
  id: string;
  version: number;
  status: PlanVersionStatus;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  createdAt: Date;
  priceCount: number;
  entitlementCount: number;
}

export class BillingPlanOverviewResponseDto {
  id: string;
  productId: string;
  productCode?: string;
  product?: BillingProductResponseDto;
  code: string;
  name: string;
  description: string | null;
  status: BillingPlanStatus;
  publishedVersion?: BillingPlanVersionSummaryResponseDto | null;
}

export class BillingPlanResponseDto extends BillingPlanOverviewResponseDto {
  versions: BillingPlanVersionResponseDto[];
}

export class BillingAddonResponseDto {
  id: string;
  productId: string;
  productCode: string;
  code: string;
  name: string;
  description: string | null;
  unitPrice: string;
  currency: BillingCurrency;
  billingInterval: BillingInterval;
  type: BillingAddonType;
  pricingModel: BillingAddonPricingModel;
  minQuantity: number;
  maxQuantity: number | null;
  provider: BillingProvider;
  providerPlanId: string | null;
  entitlementEffects: AddonEntitlementEffects;
  status: AddonStatus;
}
