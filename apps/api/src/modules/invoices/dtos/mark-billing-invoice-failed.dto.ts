import { IsString, MaxLength } from 'class-validator';

export class MarkBillingInvoiceFailedDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}
