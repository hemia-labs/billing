import {
  IsEnum,
  IsInt,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { BILLING_CURRENCIES, BillingInterval } from '../../billing-shared';
import type { AddonEntitlementEffects, BillingCurrency } from '../../billing-shared';
import {
  AddonStatus,
  BillingAddonPricingModel,
  BillingAddonType,
  BillingProvider,
} from '../../billing-shared';

export class CreateBillingAddonDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  productCode?: string;

  @IsString()
  @MaxLength(100)
  code: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  unitPrice: string;

  @IsIn(BILLING_CURRENCIES)
  currency: BillingCurrency;

  @IsEnum(BillingInterval)
  billingInterval: BillingInterval;

  @IsEnum(BillingAddonType)
  type: BillingAddonType;

  @IsEnum(BillingAddonPricingModel)
  pricingModel: BillingAddonPricingModel;

  @IsOptional()
  @IsInt()
  @Min(1)
  minQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantity?: number | null;

  @IsEnum(BillingProvider)
  provider: BillingProvider;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  providerPlanId?: string | null;

  @IsObject()
  entitlementEffects: AddonEntitlementEffects;

  @IsOptional()
  @IsEnum(AddonStatus)
  status?: AddonStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
