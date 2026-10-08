import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SaveServiceClientDto {
  @IsBoolean()
  enabled: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  products: string[];

  @IsIn(['organizations', 'all_for_allowed_products'])
  organizationScope: 'organizations' | 'all_for_allowed_products';

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  organizationIds?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  allowedReturnOrigins: string[];

  @IsOptional()
  @IsBoolean()
  allowSharedCheckouts?: boolean;
}
