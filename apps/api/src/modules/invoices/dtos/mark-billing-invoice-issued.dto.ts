import { IsISO8601, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class MarkBillingInvoiceIssuedDto {
  @IsString()
  @MaxLength(120)
  cfdiUuid: string;

  @IsUrl({ require_tld: false })
  xmlUrl: string;

  @IsUrl({ require_tld: false })
  pdfUrl: string;

  @IsOptional()
  @IsISO8601()
  issuedAt?: string;
}
