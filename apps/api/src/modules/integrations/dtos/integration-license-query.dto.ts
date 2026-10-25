import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ResolveIntegrationLicenseQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'organization_id must be a valid UUID' })
  organization_id?: string;

  @IsString({ message: 'product_code must be a string' })
  @MaxLength(80, { message: 'product_code cannot exceed 80 characters' })
  product_code: string;
}
