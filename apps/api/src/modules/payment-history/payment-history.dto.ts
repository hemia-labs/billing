import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class PaymentHistoryQueryDto {
  @IsUUID()
  organization_id: string;

  @IsString()
  @MaxLength(80)
  @Matches(/^\S+$/)
  product_code: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}

export type PaymentHistoryItemDto = {
  id: string;
  subscriptionId: string;
  organizationId: string;
  productCode: string;
  provider: 'paypal';
  amount: string;
  currency: string;
  status: 'paid' | 'partially_refunded' | 'refunded' | 'reversed';
  paidAt: string | null;
  createdAt: string;
  reference: string | null;
  description?: string;
  refundedAmount?: string;
};

export type PaymentHistoryPageDto = {
  items: PaymentHistoryItemDto[];
  nextCursor: string | null;
};
