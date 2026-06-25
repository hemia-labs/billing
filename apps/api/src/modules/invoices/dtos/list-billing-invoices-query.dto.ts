import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { InvoiceStatus } from '../../billing-shared';

export class ListBillingInvoicesQueryDto {
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  @IsUUID()
  payment_id?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsDateString()
  created_from?: string;

  @IsOptional()
  @IsDateString()
  created_to?: string;

  @IsOptional()
  @IsDateString()
  issued_from?: string;

  @IsOptional()
  @IsDateString()
  issued_to?: string;
}
