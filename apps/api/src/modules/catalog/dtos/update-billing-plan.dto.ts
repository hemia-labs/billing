import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BillingPlanStatus } from '../../billing-shared';
import {
  CreateFeatureDefinitionDto,
  CreatePlanVersionDto,
} from './create-billing-plan.dto';

export class UpdateBillingPlanDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  productCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(BillingPlanStatus)
  status?: BillingPlanStatus;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFeatureDefinitionDto)
  features?: CreateFeatureDefinitionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePlanVersionDto)
  version?: CreatePlanVersionDto;
}
