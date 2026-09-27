import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BillingInterval } from '../../billing-shared';
import type { BillingCurrency } from '../../billing-shared';
import {
  AddonStatus,
  BillingPlanStatus,
  BillingProductStatus,
  BillingProvider,
} from '../../billing-shared';
import { BILLING_CURRENCIES } from '../../billing-shared';

export class CatalogPaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class ListBillingProductsQueryDto extends CatalogPaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(BillingProductStatus)
  status?: BillingProductStatus;
}

export class ListBillingPlansQueryDto extends CatalogPaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsUUID()
  product_id?: string;

  @IsOptional()
  @IsEnum(BillingPlanStatus)
  status?: BillingPlanStatus;

  @IsOptional()
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @IsOptional()
  @IsIn(BILLING_CURRENCIES)
  currency?: BillingCurrency;

  @IsOptional()
  @IsEnum(BillingInterval)
  billing_interval?: BillingInterval;
}

export class ListBillingAddonsQueryDto extends CatalogPaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsUUID()
  product_id?: string;

  @IsOptional()
  @IsEnum(AddonStatus)
  status?: AddonStatus;

  @IsOptional()
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @IsOptional()
  @IsIn(BILLING_CURRENCIES)
  currency?: BillingCurrency;

  @IsOptional()
  @IsEnum(BillingInterval)
  billing_interval?: BillingInterval;
}

export class CatalogPageDto<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
