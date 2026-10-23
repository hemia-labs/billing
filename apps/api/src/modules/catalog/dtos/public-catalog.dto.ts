import { IsString, MaxLength } from 'class-validator';
import {
  BillingProvider,
  PlanPriceBillingInterval,
} from '../../billing-shared';
import type { BillingCurrency } from '../../billing-shared';

export class PublicCatalogPlanPriceDto {
  code: string;
  billingInterval: PlanPriceBillingInterval;
  billingIntervalCount: number;
  currency: BillingCurrency;
  amount: string;
}

export class PublicCatalogPlanDto {
  code: string;
  name: string;
  description: string | null;
  prices: PublicCatalogPlanPriceDto[];
  features: Record<string, unknown>;
}

export class PublicCatalogPlansResponseDto {
  productCode: string;
  plans: PublicCatalogPlanDto[];
}

export class PublicPaypalPlanResponseDto {
  productCode: string;
  planCode: string;
  planPriceCode: string;
  provider: BillingProvider.Paypal;
  paypalPlanId: string;
}

export class PublicPaypalPlanQueryDto {
  @IsString()
  @MaxLength(80)
  product_code: string;

  @IsString()
  @MaxLength(100)
  plan_code: string;

  @IsString()
  @MaxLength(100)
  plan_price_code: string;
}
