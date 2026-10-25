import { Transform } from 'class-transformer';
import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateBillingInvoiceDto {
  @IsUUID()
  organizationId: string;

  @IsUUID()
  paymentId: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/)
  rfc: string;

  @IsString()
  @MaxLength(255)
  legalName: string;

  @IsString()
  @Matches(/^\d{3}$/)
  taxRegime: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9]{3}$/)
  cfdiUse: string;
}
