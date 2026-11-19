import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsUUID,
  IsDateString,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { PaypalConnectionEnvironment } from '../billing-shared/entities/billing-paypal-connection.entity';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SavePaypalConnectionDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsIn(['sandbox', 'live']) environment: PaypalConnectionEnvironment;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(255) clientId: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  clientSecret?: string;
  @Transform(trim) @IsString() @MaxLength(255) webhookId: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  draftId?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString()
  expectedUpdatedAt?: string;
}

export class RotatePaypalConnectionDto {
  @IsString() @MinLength(1) @MaxLength(2048) clientSecret: string;
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  webhookId?: string;
}

export class ActivatePaypalConnectionDto {
  @IsDateString() expectedUpdatedAt: string;
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  expectedCurrentConnectionId: string | null;
  @ValidateIf((_object, value) => value !== null)
  @IsDateString()
  expectedCurrentUpdatedAt: string | null;
}

export class PaypalConnectionStatusDto {
  @IsBoolean() enabled: boolean;
}
