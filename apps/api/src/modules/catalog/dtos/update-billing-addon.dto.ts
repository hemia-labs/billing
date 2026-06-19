import {
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { BILLING_CURRENCIES, BillingInterval } from '../../billing-shared';
import type { BillingCurrency } from '../../billing-shared';
import { AddonStatus, BillingAddonType } from '../../billing-shared';

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
  @IsEnum(AddonStatus)
  status?: AddonStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
