import type { PaymentsConnection } from "./index";
export type PaymentsContext = {
  organizationId: string;
  subjectId: string;
  sessionId?: string;
  membershipId?: string;
};
export type PaymentsOperation =
  | "plans.read"
  | "checkout.manage"
  | "subscription.manage"
  | "license.read"
  | "legal.accept";
export type PaymentsTransactionScope = {
  kind: "user" | "webhook";
  context?: PaymentsContext;
};
export type PaymentsReceiverOptions = {
  audience: string;
  jwksUrl?: string;
  introspectionUrl?: string;
  billingClientId: string;
  consoleClientId: string;
};
export type LegalContextInput = {
  organizationId: string;
  subjectId: string;
  sessionId?: string;
  purpose: "acceptance" | "checkout_validation";
};
export type LegalContextResult = {
  organizationId: string;
  subjectId: string;
  membershipId: string;
  roles: string[];
  canContract: boolean;
};
export type PaymentsLegalOptions = {
  baseUrl: string;
  audience: string;
  resource: string;
  verificationClientId: string;
  resolveContext?: (input: LegalContextInput) => Promise<LegalContextResult>;
};
export type PaymentsLegalInput = Pick<PaymentsLegalOptions, "resolveContext"> &
  Partial<Omit<PaymentsLegalOptions, "resolveContext">>;
export type CreateCheckoutAttemptInput = {
  expectedAmountDueNow?: string;
  idempotencyKey: string;
  planCode: string;
  planPriceCode: string;
  legalAcceptanceId?: string;
  expectedSubscriptionId?: string;
};
export type CheckoutAttemptResponse = {
  provider?: string;
  attemptId: string;
  operation?: "checkout" | "change_plan";
  status: "pending" | "processing" | "ready" | "rejected";
  planCode?: string;
  planPriceCode?: string;
  checkoutId?: string;
  subscriptionId?: string;
  checkoutUrl?: string;
  checkoutStatus?: string | null;
  subscriptionStatus?: string | null;
  statusCheckedAt?: string;
  statusFresh: boolean;
  retryAfterSeconds?: number;
  errorCode?: string;
  planChange?: import("./index").PlanChangeState;
};
export type LicenseAccess = {
  active: boolean;
  source: "billing" | null;
  validUntil: string | null;
  confirmedAt: string | null;
  subscriptionId: string | null;
  planCode: string | null;
  licenseStatus: string | null;
  reason:
    "active" | "billing_inactive" | "confirmation_expired" | "not_confirmed";
  entitlements: Record<string, unknown>;
};
export type PreparedLegal = {
  requestId: string;
  identitySourceId: string;
  productCode: string;
  expiresAt: string;
  documents: {
    documentId: string;
    documentVersionId: string;
    contentHash: string;
    title: string;
    version: string;
    kind: string;
    artifacts: Record<string, { url: string }>;
  }[];
};
export type AcceptLegalInput = {
  requestId: string;
  idempotencyKey: string;
  confirmations: {
    documentVersionId: string;
    contentHash: string;
    accepted: true;
  }[];
};
export type CancelSubscriptionRequest = {
  idempotencyKey: string;
  expectedSubscriptionId: string;
  reason?: string;
};

export type PaymentAttemptInput = CreateCheckoutAttemptInput & {
  organizationId: string;
  userId: string;
  operation: "checkout" | "change_plan";
  successUrl?: string;
  cancelUrl?: string;
};
export type PaymentAttemptContext = { organizationId: string; userId: string };
export type PaymentSnapshot = {
  organizationId: string;
  productCode: string;
  revision: string;
  confirmedAt: string;
  license: import("./index").License & {
    entitlements?: Record<string, unknown>;
    billing?: Record<string, unknown>;
  };
  subscription: import("./index").Subscription | null;
};
/** Implement one atomic compare-and-write: only a greater revision may replace the saved snapshot. */
export type SnapshotSink = (
  snapshot: PaymentSnapshot,
) => Promise<{ applied: boolean }>;
