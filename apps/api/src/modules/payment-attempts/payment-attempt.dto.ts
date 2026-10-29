import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { BillingProvider } from '../billing-shared';
import { checkoutReturnUrlOptions } from '../../common/utils/checkout-return-url';
import type { CheckoutSessionStatusResponseDto } from '../checkout/dtos';

export class PaymentAttemptContextDto {
  @IsUUID() organizationId: string;
  @IsUUID() userId: string;
  @IsString() @Matches(/^\S+$/) @MaxLength(80) productCode: string;
}
export class CreatePaymentAttemptDto extends PaymentAttemptContextDto {
  @IsUUID() idempotencyKey: string;
  @IsString() @Matches(/^\S+$/) @MaxLength(100) planCode: string;
  @IsString() @Matches(/^\S+$/) @MaxLength(100) planPriceCode: string;
  @IsOptional()
  @IsIn(['checkout', 'change_plan', 'resume_renewal', 'change_renewal_plan'])
  operation?:
    'checkout' | 'change_plan' | 'resume_renewal' | 'change_renewal_plan';
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  expectedRenewalSubscriptionId?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  expectedSubscriptionId?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  expectedAmountDueNow?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  legalAcceptanceId?: string;
  @IsUrl(checkoutReturnUrlOptions) successUrl: string;
  @IsUrl(checkoutReturnUrlOptions) cancelUrl: string;
}
export interface PaymentAttemptResponse {
  renewalResume?: ReturnType<
    typeof import('../subscriptions-management/subscription-management-state').renewalResumeResponse
  >;
  abandoned?: boolean;
  provider?: BillingProvider;
  attemptId: string;
  status: 'pending' | 'processing' | 'ready' | 'rejected';
  operation:
    'checkout' | 'change_plan' | 'resume_renewal' | 'change_renewal_plan';
  renewalPlanChange?: ReturnType<
    typeof import('../subscriptions-management/renewal-plan-change-state').renewalPlanChangeResponse
  >;
  planCode: string;
  planPriceCode: string;
  checkoutId?: string;
  subscriptionId?: string;
  checkoutUrl?: string;
  checkoutStatus?: string;
  subscriptionStatus?: string;
  statusCheckedAt?: string;
  statusFresh: boolean;
  retryAfterSeconds?: number;
  errorCode?: string;
  planChange?: CheckoutSessionStatusResponseDto['planChange'];
}
