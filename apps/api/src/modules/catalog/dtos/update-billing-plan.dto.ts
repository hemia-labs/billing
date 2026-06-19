import {
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { BILLING_CURRENCIES, BillingInterval } from '../../billing-shared';
import type { BillingCurrency } from '../../billing-shared';
import { BillingPlanStatus, BillingProvider } from '../../billing-shared';

export class UpdateBillingPlanDto {
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
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  providerPlanId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @IsOptional()
  @IsIn(BILLING_CURRENCIES)
  currency?: BillingCurrency;

  @IsOptional()
  @IsString()
  amount?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  seatsIncluded?: number;

  @IsOptional()
  @IsObject()
  featuresJson?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(BillingPlanStatus)
  status?: BillingPlanStatus;
}
