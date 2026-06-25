import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  BillingCheckoutSessionStatus,
  BillingProvider,
  LicenseStatus,
  SubscriptionStatus,
} from '../../billing-shared';
import { CatalogPaginationQueryDto } from '../../catalog/dtos';

class CreatedRangeQueryDto extends CatalogPaginationQueryDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  created_from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  created_to?: Date;
}

export class ListConsoleSubscriptionsQueryDto extends CreatedRangeQueryDto {
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  product_code?: string;

  @IsOptional()
  plan_code?: string;

  @IsOptional()
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;
}

export class ListConsoleCheckoutsQueryDto extends CreatedRangeQueryDto {
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  @IsUUID()
  subscription_id?: string;

  @IsOptional()
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @IsOptional()
  @IsEnum(BillingCheckoutSessionStatus)
  status?: BillingCheckoutSessionStatus;
}

export class ListConsoleLicensesQueryDto extends CatalogPaginationQueryDto {
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  product_code?: string;

  @IsOptional()
  @IsEnum(LicenseStatus)
  status?: LicenseStatus;
}
