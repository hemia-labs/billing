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

export class UpdateBillingAddonDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  productCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  unitPrice?: string;

  @IsOptional()
  @IsIn(BILLING_CURRENCIES)
  currency?: BillingCurrency;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @IsOptional()
  @IsEnum(BillingAddonType)
  type?: BillingAddonType;

  @IsOptional()
  @IsEnum(BillingAddonPricingModel)
  pricingModel?: BillingAddonPricingModel;

  @IsOptional()
  @IsInt()
  @Min(1)
  minQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantity?: number | null;

  @IsOptional()
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  providerPlanId?: string | null;

  @IsOptional()
  @IsObject()
  entitlementEffects?: AddonEntitlementEffects;

  @IsOptional()
  @IsEnum(AddonStatus)
  status?: AddonStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
