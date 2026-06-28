import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BILLING_CURRENCIES } from '../../billing-shared';
import type { BillingCurrency } from '../../billing-shared';
import {
  BillingPlanStatus,
  BillingProvider,
  FeatureAggregationStrategy,
  FeatureValueType,
  PlanPriceBillingInterval,
  PlanPriceStatus,
  PlanVersionStatus,
  ProviderPriceStatus,
} from '../../billing-shared';

export class CreateProviderPriceDto {
  @IsEnum(BillingProvider)
  provider: BillingProvider;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  providerProductId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  providerPriceId?: string | null;

  @IsOptional()
  @IsObject()
  providerMetadata?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(ProviderPriceStatus)
  status?: ProviderPriceStatus;
}

export class CreatePlanPriceDto {
  @IsString()
  @MaxLength(100)
  code: string;

  @IsEnum(PlanPriceBillingInterval)
  billingInterval: PlanPriceBillingInterval;

  @IsInt()
  @Min(1)
  billingIntervalCount: number;

  @IsIn(BILLING_CURRENCIES)
  currency: BillingCurrency;

  @IsString()
  amount: string;

  @IsOptional()
  @IsEnum(PlanPriceStatus)
  status?: PlanPriceStatus;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProviderPriceDto)
  providerPrices: CreateProviderPriceDto[];
}

export class CreatePlanEntitlementDto {
  @IsOptional()
  @IsUUID()
  featureId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  featureCode?: string;

  valueJson: unknown;
}

export class CreateFeatureDefinitionDto {
  @IsString()
  @MaxLength(120)
  code: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsEnum(FeatureValueType)
  valueType: FeatureValueType;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string | null;

  @IsOptional()
  @IsEnum(FeatureAggregationStrategy)
  aggregationStrategy?: FeatureAggregationStrategy;

  @IsOptional()
  @IsBoolean()
  isMetered?: boolean;
}

export class CreatePlanVersionDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @IsEnum(PlanVersionStatus)
  status?: PlanVersionStatus;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string | null;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePlanPriceDto)
  prices: CreatePlanPriceDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePlanEntitlementDto)
  entitlements?: CreatePlanEntitlementDto[];
}

export class CreateBillingPlanDto {
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
  description?: string | null;

  @IsOptional()
  @IsEnum(BillingPlanStatus)
  status?: BillingPlanStatus;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFeatureDefinitionDto)
  features?: CreateFeatureDefinitionDto[];

  @ValidateNested()
  @Type(() => CreatePlanVersionDto)
  version: CreatePlanVersionDto;
}
