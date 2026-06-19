import { IsString, MaxLength } from 'class-validator';

export class CatalogProductQueryDto {
  @IsString()
  @MaxLength(80)
  product_code: string;
}
