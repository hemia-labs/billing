import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { BillingProductStatus } from '../../billing-shared';

export class UpdateBillingProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(BillingProductStatus)
  status?: BillingProductStatus;
}
