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

  @IsOptional()
  @IsEnum(AddonStatus)
  status?: AddonStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
