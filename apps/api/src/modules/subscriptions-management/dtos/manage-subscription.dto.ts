import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { checkoutReturnUrlOptions } from '../../../common/utils/checkout-return-url';

export class CurrentSubscriptionQueryDto {
  @IsUUID()
  organization_id: string;

  @IsString()
  @MaxLength(80)
  product_code: string;
}

export class CancelSubscriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class ChangePlanDto {
  @IsString()
  @Matches(/^\S+$/)
  @MaxLength(120)
  idempotencyKey: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsString()
  @MaxLength(100)
  targetPlanCode: string;

  @IsString()
  @MaxLength(100)
  targetPlanPriceCode: string;

  @IsString()
  @MaxLength(150)
  legalAcceptanceId: string;

  @IsUrl(checkoutReturnUrlOptions)
  successUrl: string;

  @IsUrl(checkoutReturnUrlOptions)
  cancelUrl: string;

  @IsOptional()
  @IsEmail()
  billingEmail?: string;
}
