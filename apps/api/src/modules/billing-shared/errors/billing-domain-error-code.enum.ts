export enum BillingDomainErrorCode {
  ProductNotFound = 'PRODUCT_NOT_FOUND',
  PlanNotFound = 'PLAN_NOT_FOUND',
  SubscriptionNotFound = 'SUBSCRIPTION_NOT_FOUND',
  LicenseNotFound = 'LICENSE_NOT_FOUND',
  PaymentNotFound = 'PAYMENT_NOT_FOUND',
  CheckoutSessionNotFound = 'CHECKOUT_SESSION_NOT_FOUND',
  WebhookEventNotFound = 'WEBHOOK_EVENT_NOT_FOUND',
  InvalidProvider = 'INVALID_PROVIDER',
  InvalidStatusTransition = 'INVALID_STATUS_TRANSITION',
  LegalAcceptanceRequired = 'LEGAL_ACCEPTANCE_REQUIRED',
}
