import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
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
  @IsString()
  @Matches(/^\S+$/)
  @MaxLength(120)
  idempotencyKey: string;

  @IsUUID()
  actorUserId: string;

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

  @IsUUID()
  actorUserId: string;

  @IsString()
  @MaxLength(100)
  targetPlanCode: string;

  @IsString()
  @MaxLength(100)
  targetPlanPriceCode: string;

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
