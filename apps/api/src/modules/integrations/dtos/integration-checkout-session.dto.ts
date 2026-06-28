import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { BillingProvider } from '../../billing-shared';

export class CreateIntegrationCheckoutSessionDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsString()
  @MaxLength(80)
  productCode: string;

  @IsString()
  @MaxLength(100)
  planCode: string;

  @IsString()
  @MaxLength(100)
  planPriceCode: string;

  @IsEnum(BillingProvider)
  provider: BillingProvider;

  @IsString()
  @MaxLength(150)
  legalAcceptanceId: string;

  @IsUrl({ require_tld: false })
  successUrl: string;

  @IsUrl({ require_tld: false })
  cancelUrl: string;

  @IsOptional()
  @IsEmail()
  billingEmail?: string;
}
