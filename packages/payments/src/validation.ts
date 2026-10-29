import { PaymentsError } from "./errors";
import type {
  AcceptLegalInput,
  CancelSubscriptionRequest,
  CreateCheckoutAttemptInput,
  LegalContextInput,
  PaymentsContext,
  ResumeRenewalRequest,
  ChangeRenewalPlanRequest,
} from "./contracts";
export const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
export const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const text = (v: unknown, max = 120): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
export function exact(
  v: unknown,
  keys: string[],
): asserts v is Record<string, unknown> {
  if (!record(v) || Object.keys(v).some((k) => !keys.includes(k)))
    throw new PaymentsError("configuration", 400);
}
export function context(v: unknown): asserts v is PaymentsContext {
  if (
    !record(v) ||
    !uuid(v.organizationId) ||
    !uuid(v.subjectId) ||
    (v.sessionId !== undefined && !uuid(v.sessionId)) ||
    (v.membershipId !== undefined && !uuid(v.membershipId))
  )
    throw new PaymentsError("authentication", 403);
}
export function attemptInput(v: unknown): CreateCheckoutAttemptInput {
  exact(v, [
    "idempotencyKey",
    "planCode",
    "planPriceCode",
    "legalAcceptanceId",
    "expectedSubscriptionId",
    "expectedAmountDueNow",
  ]);
  if (
    !uuid(v.idempotencyKey) ||
    (v.expectedAmountDueNow !== undefined &&
      (typeof v.expectedAmountDueNow !== "string" ||
        !/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/.test(v.expectedAmountDueNow))) ||
    !text(v.planCode, 100) ||
    /\s/.test(v.planCode) ||
    !text(v.planPriceCode, 100) ||
    /\s/.test(v.planPriceCode) ||
    (v.legalAcceptanceId !== undefined && !uuid(v.legalAcceptanceId)) ||
    (v.expectedSubscriptionId !== undefined && !uuid(v.expectedSubscriptionId))
  )
    throw new PaymentsError("configuration", 400);
  return v as CreateCheckoutAttemptInput;
}
export function prepareInput(v: unknown): string {
  exact(v, ["idempotencyKey"]);
  if (!uuid(v.idempotencyKey)) throw new PaymentsError("configuration", 400);
  return v.idempotencyKey;
}
export function acceptInput(v: unknown): AcceptLegalInput {
  exact(v, ["requestId", "idempotencyKey", "confirmations"]);
  if (
    !uuid(v.requestId) ||
    !uuid(v.idempotencyKey) ||
    !Array.isArray(v.confirmations) ||
    !v.confirmations.length ||
    v.confirmations.length > 100
  )
    throw new PaymentsError("configuration", 400);
  for (const c of v.confirmations) {
    exact(c, ["documentVersionId", "contentHash", "accepted"]);
    if (
      !uuid(c.documentVersionId) ||
      typeof c.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(c.contentHash) ||
      c.accepted !== true
    )
      throw new PaymentsError("configuration", 400);
  }
  if (
    new Set(
      (v.confirmations as Record<string, unknown>[]).map(
        (c) => c.documentVersionId,
      ),
    ).size !== v.confirmations.length
  )
    throw new PaymentsError("configuration", 400);
  return v as AcceptLegalInput;
}
export function legalContextInput(v: unknown): LegalContextInput {
  exact(v, ["organizationId", "subjectId", "sessionId", "purpose"]);
  const purpose = v.purpose;
  context(v);
  if (
    !["acceptance", "checkout_validation"].includes(String(purpose)) ||
    (purpose === "acceptance" && !uuid(v.sessionId))
  )
    throw new PaymentsError("configuration", 400);
  return v as LegalContextInput;
}
export function endpoint(value: string, local: boolean): URL {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    (u.protocol !== "https:" &&
      !(
        local &&
        process.env.NODE_ENV !== "production" &&
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      ))
  )
    throw new Error("Invalid service endpoint");
  return u;
}
const statuses = [
  "created",
  "pending",
  "approved",
  "cancelled",
  "expired",
  "failed",
];
const subscriptions = [
  "pending",
  "active",
  "past_due",
  "suspended",
  "cancelled",
  "expired",
];
const nonnegative = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function webhookInput(v: unknown, product: string) {
  exact(v, [
    "type",
    "organizationId",
    "productCode",
    "revision",
    "license",
    "checkouts",
    "subscription",
    "confirmedAt",
  ]);
  if (
    v.type !== "billing.license.updated" ||
    !uuid(v.organizationId) ||
    v.productCode !== product ||
    typeof v.revision !== "string" ||
    !/^[1-9][0-9]{0,18}$/.test(v.revision) ||
    BigInt(v.revision) > 9223372036854775807n ||
    !Array.isArray(v.checkouts) ||
    v.checkouts.length > 100
  )
    throw new PaymentsError("configuration", 400);
  const l = v.license;
  exact(l, [
    "active",
    "productCode",
    "subscriptionId",
    "planCode",
    "licenseStatus",
    "validUntil",
    "seatsLimit",
    "usageLimit",
    "features",
    "entitlements",
    "billing",
  ]);
  if (
    typeof l.active !== "boolean" ||
    l.productCode !== product ||
    !(l.subscriptionId === null || uuid(l.subscriptionId)) ||
    !(l.planCode === null || text(l.planCode, 100)) ||
    !["active", "grace", "suspended", "revoked", "expired"].includes(
      String(l.licenseStatus),
    ) ||
    !(
      l.validUntil === null ||
      (typeof l.validUntil === "string" &&
        Number.isFinite(Date.parse(l.validUntil)))
    ) ||
    !nonnegative(l.seatsLimit) ||
    !(l.usageLimit === null || nonnegative(l.usageLimit)) ||
    !record(l.features) ||
    (l.entitlements !== undefined && !record(l.entitlements)) ||
    (l.billing !== undefined && !record(l.billing)) ||
    (l.active &&
      (!l.subscriptionId ||
        !l.planCode ||
        !["active", "grace"].includes(String(l.licenseStatus)))) ||
    (l.active && l.licenseStatus === "grace" && !l.validUntil)
  )
    throw new PaymentsError("configuration", 400);
  if (Buffer.byteLength(JSON.stringify(v)) > 262144)
    throw new PaymentsError("configuration", 400);
  for (const c of v.checkouts) {
    exact(c, [
      "checkoutId",
      "subscriptionId",
      "checkoutStatus",
      "subscriptionStatus",
    ]);
    if (
      !uuid(c.checkoutId) ||
      !(c.subscriptionId === null || uuid(c.subscriptionId)) ||
      !statuses.includes(String(c.checkoutStatus)) ||
      !(
        c.subscriptionStatus === null ||
        (typeof c.subscriptionStatus === "string" &&
          subscriptions.includes(c.subscriptionStatus))
      )
    )
      throw new PaymentsError("configuration", 400);
  }
  if (
    new Set((v.checkouts as Record<string, unknown>[]).map((c) => c.checkoutId))
      .size !== v.checkouts.length
  )
    throw new PaymentsError("configuration", 400);
  return {
    organizationId: v.organizationId,
    productCode: product,
    revision: v.revision,
    license: l,
    checkouts: v.checkouts,
  };
}

export function cancellationInput(v: unknown): CancelSubscriptionRequest {
  exact(v, ["idempotencyKey", "reason", "expectedSubscriptionId"]);
  if (
    !uuid(v.idempotencyKey) ||
    !uuid(v.expectedSubscriptionId) ||
    (v.reason !== undefined && (!text(v.reason, 500) || !v.reason.trim()))
  )
    throw new PaymentsError("configuration", 400);
  return v as CancelSubscriptionRequest;
}

export function planChangeQuoteInput(v: unknown) {
  exact(v, ["targetPlanCode", "targetPlanPriceCode"]);
  if (
    !text(v.targetPlanCode, 100) ||
    /\s/.test(v.targetPlanCode) ||
    !text(v.targetPlanPriceCode, 100) ||
    /\s/.test(v.targetPlanPriceCode)
  )
    throw new PaymentsError("configuration", 400);
  return {
    targetPlanCode: v.targetPlanCode,
    targetPlanPriceCode: v.targetPlanPriceCode,
  };
}

export function resumeRenewalInput(v: unknown): ResumeRenewalRequest {
  exact(v, ["idempotencyKey", "expectedSubscriptionId"]);
  if (!uuid(v.idempotencyKey) || !uuid(v.expectedSubscriptionId))
    throw new PaymentsError("configuration", 400);
  return v as ResumeRenewalRequest;
}

export function changeRenewalPlanInput(v: unknown): ChangeRenewalPlanRequest {
  exact(v, ["idempotencyKey", "expectedSubscriptionId", "expectedRenewalSubscriptionId", "targetPlanCode", "targetPlanPriceCode"]);
  if (!uuid(v.idempotencyKey) || !uuid(v.expectedSubscriptionId) || !uuid(v.expectedRenewalSubscriptionId) ||
      v.expectedSubscriptionId === v.expectedRenewalSubscriptionId ||
      !text(v.targetPlanCode, 100) || /\s/.test(v.targetPlanCode) ||
      !text(v.targetPlanPriceCode, 100) || /\s/.test(v.targetPlanPriceCode))
    throw new PaymentsError("configuration", 400);
  return v as ChangeRenewalPlanRequest;
}
