import { BillingInterval } from '../../billing-shared';
import type { AddonEntitlementEffects, BillingCurrency } from '../../billing-shared';
import {
  AddonStatus,
  BillingAddonPricingModel,
  BillingAddonType,
  BillingPlanStatus,
  BillingProductStatus,
  BillingProvider,
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

export class BillingPlanResponseDto {
  id: string;
  productId: string;
  productCode?: string;
  code: string;
  provider: BillingProvider;
  providerPlanId: string | null;
  name: string;
  billingInterval: BillingInterval;
  currency: BillingCurrency;
  amount: string;
  seatsIncluded: number;
  featuresJson: Record<string, unknown>;
  status: BillingPlanStatus;
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
