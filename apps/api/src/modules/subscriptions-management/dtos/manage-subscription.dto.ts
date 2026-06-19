import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

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
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsString()
  @MaxLength(100)
  targetPlanCode: string;

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
