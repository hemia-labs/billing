import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { BillingProvider } from '../../billing-shared';
import { checkoutReturnUrlOptions } from '../../../common/utils/checkout-return-url';

export class CreateCheckoutSessionDto {
  @IsString()
  @Matches(/^\S+$/)
  @MaxLength(120)
  idempotencyKey: string;

  @IsUUID()
  organizationId: string;

  @IsUUID()
  userId: string;

  @IsString()
  @MaxLength(80)
  productCode: string;

  @IsString()
  @MaxLength(100)
  planCode: string;

  @IsString()
  @MaxLength(100)
  planPriceCode: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  legalAcceptanceId?: string;

  @IsUrl(checkoutReturnUrlOptions)
  successUrl: string;

  @IsUrl(checkoutReturnUrlOptions)
  cancelUrl: string;

  @IsOptional()
  @IsEmail()
  billingEmail?: string;
}
