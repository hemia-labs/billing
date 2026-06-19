import { BillingDomainErrorCode } from './billing-domain-error-code.enum';

export const BILLING_DOMAIN_ERROR_MESSAGES: Record<
  BillingDomainErrorCode,
  string
> = {
  [BillingDomainErrorCode.ProductNotFound]: 'Billing product not found',
  [BillingDomainErrorCode.PlanNotFound]: 'Billing plan not found',
  [BillingDomainErrorCode.SubscriptionNotFound]:
    'Billing subscription not found',
  [BillingDomainErrorCode.LicenseNotFound]: 'Billing license not found',
  [BillingDomainErrorCode.PaymentNotFound]: 'Billing payment not found',
  [BillingDomainErrorCode.CheckoutSessionNotFound]:
    'Billing checkout session not found',
  [BillingDomainErrorCode.WebhookEventNotFound]:
    'Billing webhook event not found',
  [BillingDomainErrorCode.InvalidProvider]: 'Invalid billing provider',
  [BillingDomainErrorCode.InvalidStatusTransition]:
    'Invalid billing status transition',
  [BillingDomainErrorCode.LegalAcceptanceRequired]:
    'Legal acceptance is required before checkout',
};

export const getBillingDomainErrorMessage = (
  code: BillingDomainErrorCode,
): string =>
  BILLING_DOMAIN_ERROR_MESSAGES[code] ?? 'Unexpected billing domain error';
