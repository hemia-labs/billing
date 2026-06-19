import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { BillingProductStatus } from '../../billing-shared';

export class CreateBillingProductDto {
  @IsString()
  @MaxLength(80)
  code: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(BillingProductStatus)
  status?: BillingProductStatus;
}
