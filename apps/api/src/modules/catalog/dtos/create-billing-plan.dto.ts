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

  @IsEnum(BillingProvider)
  provider: BillingProvider;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  providerPlanId?: string | null;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsEnum(BillingInterval)
  billingInterval: BillingInterval;

  @IsIn(BILLING_CURRENCIES)
  currency: BillingCurrency;

  @IsString()
  amount: string;

  @IsInt()
  @Min(0)
  seatsIncluded: number;

  @IsOptional()
  @IsObject()
  featuresJson?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(BillingPlanStatus)
  status?: BillingPlanStatus;
}
