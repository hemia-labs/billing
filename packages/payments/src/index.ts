import type {
  PaymentAttemptInput,
  PaymentAttemptContext,
  CheckoutAttemptResponse,
  PaymentSnapshot,
} from "./contracts";
import { webhookInput } from "./validation";
import { PaymentsError } from "./errors";
export * from "./contracts";
export { createPaymentsReceiver } from "./receiver";
export { createPaymentsLegalClient } from "./legal";
import { MachineClient, MachineClientError } from "@hemia/auth";
import { isIP } from "node:net";

export type PaymentsConnection = {
  issuer: string;
  tokenUrl: string;
  clientId: string;
  baseUrl: string;
  audience: string;
  resource?: string;
  productCode: string;
  successUrl?: string;
  cancelUrl?: string;
  allowHttpLoopback?: boolean;
  tokenTimeoutMs?: number;
  requestTimeoutMs?: number;
  receiver?: {
    audience: string;
    billingClientId: string;
    consoleClientId: string;
  };
  legal?: {
    baseUrl: string;
    audience: string;
    resource: string;
    verificationClientId: string;
  };
};
export type PaymentsConfig = PaymentsConnection & { clientSecret: string };
export type CheckoutInput = {
  organizationId: string;
  userId: string;
  planCode: string;
  planPriceCode: string;
  legalAcceptanceId?: string;
  idempotencyKey: string;
  expectedAmountDueNow?: string;
  billingEmail?: string;
  successUrl?: string;
  cancelUrl?: string;
};
export type Subscription = {
  id: string;
  organizationId: string;
  productCode: string;
  planCode: string;
  planPriceCode: string | null;
  status:
    "pending" | "active" | "past_due" | "suspended" | "cancelled" | "expired";
  currentPeriodEnd: string | null;
  nextBillingTime: string | null;
  cancelAtPeriodEnd: boolean;
  cancellation: {
    state: "pending" | "scheduled";
    requestedAt: string;
    effectiveAt: string | null;
  } | null;
  pendingPlanChange:
    | (Partial<PlanChangeQuote> & {
        action?: "approve_subscription" | "approve_payment" | "none";
        state:
          | "preparing"
          | "awaiting_approval"
          | "scheduled"
          | "effective"
          | "failed";
        targetPlanCode: string;
        targetPlanPriceCode: string;
        effectiveAt: string;
        checkoutId: string | null;
        newSubscriptionId: string | null;
        attemptId?: string;
        checkoutUrl?: string | null;
        cancellationRequested?: boolean;
      })
    | null;
};
export type CancelCheckoutAttemptResponse = {
  cancelled: boolean;
  approvalUrl?: string;
};
export type CancelSubscriptionInput = {
  idempotencyKey: string;
  actorUserId: string;
  reason?: string;
};
export type PlanChangeQuote = {
  kind: "upgrade" | "downgrade";
  amountDueNow: string;
  currency: string;
  effectiveAt: string;
  nextBillingAt: string;
  recurringAmount: string;
};
export type PlanChangeState = {
  cancellationRequested?: boolean;
  kind?: "upgrade" | "downgrade";
  amountDueNow?: string;
  currency?: string;
  recurringAmount?: string;
  nextBillingAt?: string;
  action?: "approve_subscription" | "approve_payment" | "none";
  checkoutUrl?: string | null;
  state:
    "preparing" | "awaiting_approval" | "scheduled" | "effective" | "failed";
  effectiveAt: string;
};
export type ChangePlan = {
  provider?: string;
  planChange?: PlanChangeState;
  subscription: Subscription;
  checkoutId: string;
  newSubscriptionId: string;
  checkoutUrl: string;
  targetPlanCode: string;
  effectiveAt: string;
  state: "awaiting_approval" | "scheduled" | "effective";
};
export type Checkout = {
  provider?: string;
  checkoutId: string;
  subscriptionId: string;
  checkoutUrl: string;
  status: string;
};
export type CheckoutStatus = {
  checkoutUrl?: string | null;
  checkoutId: string;
  subscriptionId: string;
  checkoutStatus: string;
  subscriptionStatus: string;
  provider?: string;
  planChange?: PlanChangeState;
};
export type PlanPrice = {
  code: string;
  amount: string;
  currency: string;
  billingInterval: "month" | "year";
  billingIntervalCount: number;
};
export type Plan = {
  code: string;
  name: string;
  description: string | null;
  version: number;
  prices: PlanPrice[];
  features: {
    code: string;
    name: string;
    unit: string | null;
    value: unknown;
  }[];
};
export type License = {
  entitlements?: Record<string, unknown>;
  billing?: Record<string, unknown>;
  active: boolean;
  productCode: string;
  planCode: string | null;
  licenseStatus: "active" | "grace" | "suspended" | "revoked" | "expired";
  validUntil: string | null;
  seatsLimit: number;
  usageLimit: number | null;
  subscriptionId: string | null;
  features: Record<string, unknown>;
};

export { PaymentsError } from "./errors";

const permissions = {
  catalog: "billing.integration.catalog.read",
  create: "billing.integration.checkout.create",
  status: "billing.integration.checkout.read",
  licenses: "billing.integration.licenses.read",
  subscriptions: "billing.subscriptions.manage",
};
const statuses = [
  "created",
  "pending",
  "approved",
  "cancelled",
  "expired",
  "failed",
];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown, max = 2000): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const identifier = (v: unknown): v is string => string(v, 120) && !/\s/.test(v);
const date = (v: unknown): v is string | null =>
  v === null || (typeof v === "string" && Number.isFinite(Date.parse(v)));
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const list = (v: unknown, max = 200): v is Record<string, unknown>[] =>
  Array.isArray(v) && v.length <= max && v.every(record);

function endpoint(value: string, local: boolean): URL {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          local &&
          process.env.NODE_ENV !== "production" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error();
    return url;
  } catch {
    throw new PaymentsError("configuration");
  }
}

/** Server-only client. Every operation uses its own scope and never retries a POST. */
export function createPaymentsClient(config: PaymentsConfig) {
  if (typeof window !== "undefined") throw new PaymentsError("configuration");
  if (!config || !identifier(config.productCode))
    throw new PaymentsError("configuration");
  const success =
    config.successUrl === undefined
      ? undefined
      : endpoint(config.successUrl, config.allowHttpLoopback === true);
  const cancel =
    config.cancelUrl === undefined
      ? undefined
      : endpoint(config.cancelUrl, config.allowHttpLoopback === true);
  let machine: MachineClient;
  try {
    machine = new MachineClient({
      issuer: config.issuer,
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      destinations: {
        billing: {
          baseUrl: config.baseUrl,
          audience: config.audience,
          resource: config.resource,
          scopes: Object.values(permissions),
        },
      },
      allowHttpLoopback: config.allowHttpLoopback,
      tokenTimeoutMs: config.tokenTimeoutMs,
      requestTimeoutMs: config.requestTimeoutMs,
    });
  } catch {
    throw new PaymentsError("configuration");
  }
  const productCode = config.productCode;
  async function request(
    path: string,
    permission: string | string[],
    payload?: unknown,
    management = false,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await machine.request(
        "billing",
        management ? `billing/${path}` : `billing/integrations/v1/${path}`,
        {
          method: payload === undefined ? "GET" : "POST",
          scopes: typeof permission === "string" ? [permission] : permission,
          headers: {
            Accept: "application/json",
            ...(payload === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        },
      );
    } catch (error) {
      throw new PaymentsError(
        error instanceof MachineClientError && error.stage === "token"
          ? "authentication"
          : "transport",
      );
    }
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (
        response.status === 422 &&
        record(value) &&
        value.status === "rejected" &&
        uuid.test(String(value.attemptId))
      )
        return value;
      if (
        response.status === 409 &&
        record(value) &&
        value.code === "CHECKOUT_IN_PROGRESS"
      ) {
        const seconds = Number(value.retryAfterSeconds);
        throw new PaymentsError(
          "CHECKOUT_IN_PROGRESS",
          409,
          Number.isFinite(seconds) && seconds > 0
            ? Math.min(60, Math.max(1, Math.ceil(seconds)))
            : 5,
        );
      }
      throw new PaymentsError("http", response.status);
    }
    return value;
  }
  function attemptContext(id: string, c: PaymentAttemptContext) {
    if (
      !uuid.test(id) ||
      !c ||
      !uuid.test(c.organizationId) ||
      !uuid.test(c.userId)
    )
      throw new PaymentsError("configuration", 400);
    return new URLSearchParams({
      organizationId: c.organizationId.toLowerCase(),
      userId: c.userId.toLowerCase(),
      productCode,
    });
  }
  const attempts = {
    async create(input: PaymentAttemptInput): Promise<CheckoutAttemptResponse> {
      if (
        !input ||
        !uuid.test(input.idempotencyKey) ||
        !uuid.test(input.organizationId) ||
        !uuid.test(input.userId) ||
        !identifier(input.planCode) ||
        !identifier(input.planPriceCode) ||
        !["checkout", "change_plan"].includes(input.operation) ||
        (input.operation === "change_plan"
          ? !uuid.test(String(input.expectedSubscriptionId))
          : input.expectedSubscriptionId !== undefined) ||
        (input.expectedAmountDueNow !== undefined &&
          !money(input.expectedAmountDueNow)) ||
        (input.legalAcceptanceId !== undefined &&
          !uuid.test(input.legalAcceptanceId))
      )
        throw new PaymentsError("configuration", 400);
      const successValue = input.successUrl ?? success?.href;
      const cancelValue = input.cancelUrl ?? cancel?.href;
      if (!successValue || !cancelValue)
        throw new PaymentsError("configuration");
      const successUrl = endpoint(
        successValue,
        config.allowHttpLoopback === true,
      );
      const cancelUrl = endpoint(
        cancelValue,
        config.allowHttpLoopback === true,
      );
      if (
        (success && successUrl.origin !== success.origin) ||
        (cancel && cancelUrl.origin !== cancel.origin)
      )
        throw new PaymentsError("configuration");
      const scopes =
        input.operation === "change_plan"
          ? [permissions.create, permissions.subscriptions]
          : [permissions.create];
      return parseAttempt(
        await request("payment-attempts", scopes, {
          planCode: input.planCode,
          planPriceCode: input.planPriceCode,
          operation: input.operation,
          ...(input.expectedAmountDueNow === undefined
            ? {}
            : { expectedAmountDueNow: input.expectedAmountDueNow }),
          ...(input.legalAcceptanceId === undefined
            ? {}
            : { legalAcceptanceId: input.legalAcceptanceId }),
          organizationId: input.organizationId.toLowerCase(),
          userId: input.userId.toLowerCase(),
          idempotencyKey: input.idempotencyKey.toLowerCase(),
          ...(input.expectedSubscriptionId
            ? {
                expectedSubscriptionId:
                  input.expectedSubscriptionId.toLowerCase(),
              }
            : {}),
          productCode,
          successUrl: successUrl.href,
          cancelUrl: cancelUrl.href,
        }),
        input.idempotencyKey,
      );
    },
    async get(
      id: string,
      c: PaymentAttemptContext,
    ): Promise<CheckoutAttemptResponse> {
      return parseAttempt(
        await request(
          `payment-attempts/${id}?${attemptContext(id, c)}`,
          permissions.status,
        ),
        id,
      );
    },
    async retry(
      id: string,
      c: PaymentAttemptContext,
    ): Promise<CheckoutAttemptResponse> {
      const current = await attempts.get(id, c);
      const scopes =
        current.operation === "change_plan"
          ? [permissions.create, permissions.subscriptions]
          : [permissions.create];
      return parseAttempt(
        await request(
          `payment-attempts/${id}/retry?${attemptContext(id, c)}`,
          scopes,
          {},
        ),
        id,
      );
    },
    async confirm(
      id: string,
      c: PaymentAttemptContext,
    ): Promise<CheckoutAttemptResponse> {
      return parseAttempt(
        await request(
          `payment-attempts/${id}/confirm?${attemptContext(id, c)}`,
          permissions.subscriptions,
          {},
        ),
        id,
      );
    },
    async cancel(
      id: string,
      c: PaymentAttemptContext,
    ): Promise<CancelCheckoutAttemptResponse> {
      const value = await request(
        `payment-attempts/${id}/cancel?${attemptContext(id, c)}`,
        permissions.subscriptions,
        {},
      );
      if (
        !record(value) ||
        typeof value.cancelled !== "boolean" ||
        (value.approvalUrl !== undefined &&
          (typeof value.approvalUrl !== "string" ||
            !checkoutUrl(value.approvalUrl))) ||
        (value.cancelled && value.approvalUrl !== undefined)
      )
        throw new PaymentsError("contract");
      return {
        cancelled: value.cancelled,
        ...(value.approvalUrl === undefined
          ? {}
          : { approvalUrl: value.approvalUrl }),
      };
    },
  };
  const checkout = {
    async create(input: CheckoutInput): Promise<Checkout> {
      if (
        !input ||
        !uuid.test(input.organizationId) ||
        !uuid.test(input.userId) ||
        !identifier(input.idempotencyKey) ||
        !identifier(input.planCode) ||
        !identifier(input.planPriceCode) ||
        (input.legalAcceptanceId !== undefined &&
          (typeof input.legalAcceptanceId !== "string" ||
            !uuid.test(input.legalAcceptanceId)))
      )
        throw new PaymentsError("configuration");
      const successValue = input.successUrl ?? success?.href;
      const cancelValue = input.cancelUrl ?? cancel?.href;
      if (!successValue || !cancelValue)
        throw new PaymentsError("configuration");
      const successUrl = endpoint(
        successValue,
        config.allowHttpLoopback === true,
      );
      const cancelUrl = endpoint(
        cancelValue,
        config.allowHttpLoopback === true,
      );
      if (
        (success && successUrl.origin !== success.origin) ||
        (cancel && cancelUrl.origin !== cancel.origin)
      )
        throw new PaymentsError("configuration");
      const value = await request("checkout/sessions", permissions.create, {
        idempotencyKey: input.idempotencyKey,
        organizationId: input.organizationId,
        userId: input.userId,
        productCode,
        planCode: input.planCode,
        planPriceCode: input.planPriceCode,
        ...(input.legalAcceptanceId === undefined
          ? {}
          : { legalAcceptanceId: input.legalAcceptanceId }),
        successUrl: successUrl.href,
        cancelUrl: cancelUrl.href,
        ...(input.billingEmail === undefined
          ? {}
          : { billingEmail: input.billingEmail }),
      });
      if (
        !record(value) ||
        !uuid.test(String(value.checkoutId)) ||
        !uuid.test(String(value.subscriptionId)) ||
        !statuses.includes(String(value.status)) ||
        !string(value.checkoutUrl) ||
        (value.provider !== undefined && !identifier(value.provider))
      )
        throw new PaymentsError("contract");
      if (!checkoutUrl(value.checkoutUrl)) throw new PaymentsError("contract");
      return {
        ...(value.provider === undefined
          ? {}
          : { provider: value.provider as string }),
        checkoutId: value.checkoutId as string,
        subscriptionId: value.subscriptionId as string,
        checkoutUrl: value.checkoutUrl,
        status: value.status as string,
      };
    },
    async status(checkoutId: string): Promise<CheckoutStatus> {
      if (!uuid.test(checkoutId)) throw new PaymentsError("configuration");
      const value = await request(
        `checkout/sessions/${checkoutId}/status`,
        permissions.status,
      );
      return checkoutStatus(value, checkoutId);
    },
    async verify(checkoutId: string): Promise<CheckoutStatus> {
      if (!uuid.test(checkoutId)) throw new PaymentsError("configuration");
      const value = await request(
        `checkout/sessions/${checkoutId}/verify`,
        permissions.subscriptions,
        {},
        true,
      );
      return checkoutStatus(value, checkoutId);
    },
  };
  return {
    catalog: {
      async listPlans(): Promise<Plan[]> {
        const value = await request(
          `catalog/products/${encodeURIComponent(productCode)}/plans`,
          permissions.catalog,
        );
        return plans(value, productCode);
      },
    },
    checkout,
    attempts,
    snapshots: {
      async current(organizationId: string): Promise<PaymentSnapshot> {
        if (!uuid.test(organizationId))
          throw new PaymentsError("configuration", 400);
        organizationId = organizationId.toLowerCase();
        const query = new URLSearchParams({
          organization_id: organizationId,
          product_code: productCode,
        });
        return parsePaymentSnapshot(
          await request(`snapshots?${query}`, [
            permissions.licenses,
            permissions.subscriptions,
          ]),
          productCode,
          organizationId,
        );
      },
    },
    subscriptions: {
      async planChangeQuote(
        subscriptionId: string,
        targetPlanCode: string,
        targetPlanPriceCode: string,
      ): Promise<PlanChangeQuote> {
        if (
          !uuid.test(subscriptionId) ||
          !identifier(targetPlanCode) ||
          !identifier(targetPlanPriceCode)
        )
          throw new PaymentsError("configuration");
        const query = new URLSearchParams({
          target_plan_code: targetPlanCode,
          target_plan_price_code: targetPlanPriceCode,
        });
        return planChangeQuote(
          await request(
            `subscriptions/${subscriptionId}/plan-change-quote?${query}`,
            permissions.subscriptions,
            undefined,
            true,
          ),
        );
      },
      async current(organizationId: string): Promise<Subscription | null> {
        if (!uuid.test(organizationId))
          throw new PaymentsError("configuration");
        let value: unknown;
        try {
          value = await request(
            `subscriptions/current?${new URLSearchParams({ organization_id: organizationId, product_code: productCode })}`,
            permissions.subscriptions,
            undefined,
            true,
          );
        } catch (error) {
          if (error instanceof PaymentsError && error.status === 404)
            return null;
          throw error;
        }
        return subscription(value, productCode, organizationId);
      },
      async cancel(
        subscriptionId: string,
        input: CancelSubscriptionInput,
      ): Promise<Subscription> {
        if (
          !uuid.test(subscriptionId) ||
          !input ||
          !identifier(input.idempotencyKey) ||
          !uuid.test(input.actorUserId) ||
          (input.reason !== undefined &&
            (!string(input.reason, 500) || !input.reason.trim()))
        )
          throw new PaymentsError("configuration");
        const value = await request(
          `subscriptions/${subscriptionId}/cancel`,
          permissions.subscriptions,
          {
            idempotencyKey: input.idempotencyKey,
            actorUserId: input.actorUserId,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          },
          true,
        );
        const result = subscription(value, productCode);
        if (result.id !== subscriptionId) throw new PaymentsError("contract");
        return result;
      },
      async changePlan(
        subscriptionId: string,
        input: CheckoutInput,
      ): Promise<ChangePlan> {
        if (
          !uuid.test(subscriptionId) ||
          !input ||
          !uuid.test(input.organizationId) ||
          !uuid.test(input.userId) ||
          (input.expectedAmountDueNow !== undefined &&
            !money(input.expectedAmountDueNow)) ||
          !identifier(input.idempotencyKey) ||
          !identifier(input.planCode) ||
          !identifier(input.planPriceCode) ||
          (input.legalAcceptanceId !== undefined &&
            !uuid.test(input.legalAcceptanceId))
        )
          throw new PaymentsError("configuration");
        const successValue = input.successUrl ?? success?.href;
        const cancelValue = input.cancelUrl ?? cancel?.href;
        if (!successValue || !cancelValue)
          throw new PaymentsError("configuration");
        const successUrl = endpoint(
          successValue,
          config.allowHttpLoopback === true,
        );
        const cancelUrl = endpoint(
          cancelValue,
          config.allowHttpLoopback === true,
        );
        if (
          (success && successUrl.origin !== success.origin) ||
          (cancel && cancelUrl.origin !== cancel.origin)
        )
          throw new PaymentsError("configuration");
        const value = await request(
          `subscriptions/${subscriptionId}/change-plan`,
          permissions.subscriptions,
          {
            idempotencyKey: input.idempotencyKey,
            actorUserId: input.userId,
            targetPlanCode: input.planCode,
            targetPlanPriceCode: input.planPriceCode,
            ...(input.expectedAmountDueNow === undefined
              ? {}
              : { expectedAmountDueNow: input.expectedAmountDueNow }),
            ...(input.legalAcceptanceId === undefined
              ? {}
              : { legalAcceptanceId: input.legalAcceptanceId }),
            successUrl: successUrl.href,
            cancelUrl: cancelUrl.href,
            ...(input.billingEmail === undefined
              ? {}
              : { billingEmail: input.billingEmail }),
          },
          true,
        );
        if (
          !record(value) ||
          !uuid.test(String(value.checkoutId)) ||
          !uuid.test(String(value.newSubscriptionId)) ||
          value.targetPlanCode !== input.planCode ||
          !date(value.effectiveAt) ||
          value.effectiveAt === null ||
          !["awaiting_approval", "scheduled", "effective"].includes(
            String(value.state),
          ) ||
          !string(value.checkoutUrl) ||
          (value.provider !== undefined && !identifier(value.provider))
        )
          throw new PaymentsError("contract");
        const source = subscription(
          value.subscription,
          productCode,
          input.organizationId,
        );
        if (source.id !== subscriptionId) throw new PaymentsError("contract");
        let approval: URL;
        try {
          approval = new URL(value.checkoutUrl);
        } catch {
          throw new PaymentsError("contract");
        }
        const providerApproval = checkoutUrl(value.checkoutUrl);
        const confirmedReturn =
          ["scheduled", "effective"].includes(String(value.state)) &&
          approval.href === successUrl.href;
        if (
          ["scheduled", "effective"].includes(String(value.state))
            ? !confirmedReturn
            : !providerApproval || approval.href === successUrl.href
        )
          throw new PaymentsError("contract");
        return {
          ...(value.planChange === undefined
            ? {}
            : { planChange: planChangeState(value.planChange) }),
          ...(value.provider === undefined
            ? {}
            : { provider: value.provider as string }),
          subscription: source,
          checkoutId: value.checkoutId as string,
          newSubscriptionId: value.newSubscriptionId as string,
          checkoutUrl: value.checkoutUrl,
          targetPlanCode: input.planCode,
          effectiveAt: value.effectiveAt,
          state: value.state as ChangePlan["state"],
        };
      },
    },
    licenses: {
      async resolve(organizationId: string): Promise<License> {
        if (!uuid.test(organizationId))
          throw new PaymentsError("configuration");
        const value = await request(
          `licenses/resolve?${new URLSearchParams({ organization_id: organizationId, product_code: productCode })}`,
          permissions.licenses,
        );
        if (
          !record(value) ||
          typeof value.active !== "boolean" ||
          value.productCode !== productCode ||
          !(value.planCode === null || string(value.planCode)) ||
          !["active", "grace", "suspended", "revoked", "expired"].includes(
            String(value.licenseStatus),
          ) ||
          !date(value.validUntil) ||
          !count(value.seatsLimit) ||
          !(value.usageLimit === null || count(value.usageLimit)) ||
          !(
            value.subscriptionId === null ||
            uuid.test(String(value.subscriptionId))
          ) ||
          (value.active &&
            (!uuid.test(String(value.subscriptionId)) ||
              !identifier(value.planCode) ||
              !["active", "grace"].includes(String(value.licenseStatus)) ||
              (value.licenseStatus === "grace" &&
                value.validUntil === null))) ||
          !record(value.features) ||
          (value.entitlements !== undefined && !record(value.entitlements)) ||
          (value.billing !== undefined && !record(value.billing))
        )
          throw new PaymentsError("contract");
        return {
          active: value.active,
          productCode,
          planCode: value.planCode,
          licenseStatus: value.licenseStatus as License["licenseStatus"],
          validUntil: value.validUntil,
          seatsLimit: value.seatsLimit,
          usageLimit: value.usageLimit,
          subscriptionId: value.subscriptionId as string | null,
          features: value.features,
          ...(value.entitlements === undefined
            ? {}
            : { entitlements: value.entitlements }),
          ...(value.billing === undefined ? {} : { billing: value.billing }),
        };
      },
    },
  };
}
export type PaymentsClient = ReturnType<typeof createPaymentsClient>;

function plans(value: unknown, productCode: string): Plan[] {
  if (!list(value)) throw new PaymentsError("contract");
  return value.flatMap((plan) => {
    if (
      plan.productCode !== productCode ||
      plan.status !== "active" ||
      !string(plan.code) ||
      !string(plan.name) ||
      !(plan.description === null || typeof plan.description === "string") ||
      !list(plan.versions)
    )
      throw new PaymentsError("contract");
    for (const v of plan.versions) {
      if (
        !count(v.version) ||
        v.version < 1 ||
        !string(v.status) ||
        !date(v.effectiveFrom) ||
        !date(v.effectiveUntil) ||
        !list(v.prices) ||
        !list(v.entitlements, 500)
      )
        throw new PaymentsError("contract");
      for (const p of v.prices)
        if (
          !string(p.code) ||
          !string(p.amount, 64) ||
          !/^\d+(?:\.\d+)?$/.test(p.amount) ||
          typeof p.currency !== "string" ||
          !/^[A-Z]{3}$/.test(p.currency) ||
          !["month", "year"].includes(String(p.billingInterval)) ||
          !count(p.billingIntervalCount) ||
          p.billingIntervalCount < 1 ||
          p.billingIntervalCount > 1000 ||
          !string(p.status)
        )
          throw new PaymentsError("contract");
      for (const e of v.entitlements)
        if (
          !record(e.feature) ||
          !string(e.feature.code) ||
          !string(e.feature.name) ||
          !(e.feature.unit === null || typeof e.feature.unit === "string") ||
          !("valueJson" in e)
        )
          throw new PaymentsError("contract");
    }
    const now = Date.now();
    const v = plan.versions
      .filter(
        (v) =>
          v.status === "published" &&
          (v.effectiveFrom === null ||
            Date.parse(v.effectiveFrom as string) <= now) &&
          (v.effectiveUntil === null ||
            Date.parse(v.effectiveUntil as string) > now),
      )
      .sort((a, b) => Number(b.version) - Number(a.version))[0];
    if (!v) return [];
    const prices = (v.prices as Record<string, unknown>[])
      .filter((p) => p.status === "active")
      .map((p): PlanPrice => ({
        code: p.code as string,
        amount: p.amount as string,
        currency: p.currency as string,
        billingInterval: p.billingInterval as PlanPrice["billingInterval"],
        billingIntervalCount: p.billingIntervalCount as number,
      }));
    if (!prices.length) return [];
    return [
      {
        code: plan.code,
        name: plan.name,
        description: plan.description as string | null,
        version: v.version as number,
        prices,
        features: (v.entitlements as Record<string, unknown>[]).map((e) => {
          const f = e.feature as Record<string, unknown>;
          return {
            code: f.code as string,
            name: f.name as string,
            unit: f.unit as string | null,
            value:
              record(e.valueJson) && "value" in e.valueJson
                ? e.valueJson.value
                : e.valueJson,
          };
        }),
      },
    ];
  });
}

function subscription(
  value: unknown,
  productCode: string,
  organizationId?: string,
): Subscription {
  if (
    !record(value) ||
    !uuid.test(String(value.id)) ||
    !uuid.test(String(value.organizationId)) ||
    (organizationId !== undefined && value.organizationId !== organizationId) ||
    value.productCode !== productCode ||
    !identifier(value.planCode) ||
    !(value.planPriceCode === null || identifier(value.planPriceCode)) ||
    ![
      "pending",
      "active",
      "past_due",
      "suspended",
      "cancelled",
      "expired",
    ].includes(String(value.status)) ||
    !date(value.currentPeriodEnd) ||
    !date(value.nextBillingTime) ||
    typeof value.cancelAtPeriodEnd !== "boolean"
  )
    throw new PaymentsError("contract");
  const cancellation = value.cancellation;
  if (
    cancellation !== null &&
    (!record(cancellation) ||
      !["pending", "scheduled"].includes(String(cancellation.state)) ||
      !date(cancellation.requestedAt) ||
      cancellation.requestedAt === null ||
      !date(cancellation.effectiveAt))
  )
    throw new PaymentsError("contract");
  const change = value.pendingPlanChange;
  if (
    change !== null &&
    (!record(change) ||
      ![
        "preparing",
        "awaiting_approval",
        "scheduled",
        "effective",
        "failed",
      ].includes(String(change.state)) ||
      (change.attemptId !== undefined &&
        !uuid.test(String(change.attemptId))) ||
      !identifier(change.targetPlanCode) ||
      !identifier(change.targetPlanPriceCode) ||
      !date(change.effectiveAt) ||
      change.effectiveAt === null ||
      !(change.checkoutId === null || uuid.test(String(change.checkoutId))) ||
      !(
        change.newSubscriptionId === null ||
        uuid.test(String(change.newSubscriptionId))
      ))
  )
    throw new PaymentsError("contract");
  const changeDetails = record(change) ? pendingChangeDetails(change) : {};
  return {
    id: value.id as string,
    organizationId: value.organizationId as string,
    productCode,
    planCode: value.planCode,
    planPriceCode: value.planPriceCode,
    status: value.status as Subscription["status"],
    currentPeriodEnd: value.currentPeriodEnd,
    nextBillingTime: value.nextBillingTime,
    cancelAtPeriodEnd: value.cancelAtPeriodEnd,
    cancellation:
      cancellation === null
        ? null
        : ({
            state: cancellation.state,
            requestedAt: cancellation.requestedAt,
            effectiveAt: cancellation.effectiveAt,
          } as Subscription["cancellation"]),
    pendingPlanChange:
      change === null
        ? null
        : ({
            ...changeDetails,
            ...(change.attemptId === undefined
              ? {}
              : { attemptId: String(change.attemptId).toLowerCase() }),
            state: change.state,
            targetPlanCode: change.targetPlanCode,
            targetPlanPriceCode: change.targetPlanPriceCode,
            effectiveAt: change.effectiveAt,
            checkoutId: change.checkoutId,
            newSubscriptionId: change.newSubscriptionId,
          } as Subscription["pendingPlanChange"]),
  };
}

const money = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9]\d{0,17})(\.\d{1,2})?$/.test(v);
function checkoutUrl(v: unknown): v is string | null {
  if (v === null) return true;
  if (!string(v) || !/^https:\/\/[^/\\\s]/i.test(v) || /[\s\\]/.test(v))
    return false;
  try {
    const u = new URL(v);
    const hostname = u.hostname.replace(/\.$/, "");
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      hostname.includes(".") &&
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost") &&
      !isIP(hostname.replace(/^\[|\]$/g, ""))
    );
  } catch {
    return false;
  }
}
function planChangeQuote(v: unknown): PlanChangeQuote {
  if (
    !record(v) ||
    !["upgrade", "downgrade"].includes(String(v.kind)) ||
    !money(v.amountDueNow) ||
    !money(v.recurringAmount) ||
    typeof v.currency !== "string" ||
    !/^[A-Z]{3}$/.test(v.currency) ||
    !date(v.effectiveAt) ||
    v.effectiveAt === null ||
    !date(v.nextBillingAt) ||
    v.nextBillingAt === null
  )
    throw new PaymentsError("contract");
  return {
    kind: v.kind,
    amountDueNow: v.amountDueNow,
    currency: v.currency,
    recurringAmount: v.recurringAmount,
    effectiveAt: v.effectiveAt,
    nextBillingAt: v.nextBillingAt,
  } as PlanChangeQuote;
}
function planChangeState(v: unknown): PlanChangeState {
  if (
    !record(v) ||
    ![
      "preparing",
      "awaiting_approval",
      "scheduled",
      "effective",
      "failed",
    ].includes(String(v.state)) ||
    !date(v.effectiveAt) ||
    v.effectiveAt === null ||
    (v.cancellationRequested !== undefined &&
      typeof v.cancellationRequested !== "boolean")
  )
    throw new PaymentsError("contract");
  const cancellation =
    v.cancellationRequested === undefined
      ? {}
      : { cancellationRequested: v.cancellationRequested };
  if (v.kind === undefined)
    return {
      state: v.state,
      effectiveAt: v.effectiveAt,
      ...cancellation,
    } as PlanChangeState;
  const quote = planChangeQuote(v);
  if (
    !["approve_subscription", "approve_payment", "none"].includes(
      String(v.action),
    ) ||
    !checkoutUrl(v.checkoutUrl) ||
    (v.action === "approve_subscription" && v.checkoutUrl === null)
  )
    throw new PaymentsError("contract");
  return {
    ...quote,
    ...cancellation,
    state: v.state,
    action: v.action,
    checkoutUrl: v.checkoutUrl,
  } as PlanChangeState;
}
function checkoutStatus(v: unknown, id: string): CheckoutStatus {
  if (
    !record(v) ||
    v.checkoutId !== id ||
    !uuid.test(String(v.subscriptionId)) ||
    !statuses.includes(String(v.checkoutStatus)) ||
    ![
      "pending",
      "active",
      "past_due",
      "suspended",
      "cancelled",
      "expired",
    ].includes(String(v.subscriptionStatus)) ||
    (v.provider !== undefined && !identifier(v.provider)) ||
    (v.checkoutUrl !== undefined && !checkoutUrl(v.checkoutUrl))
  )
    throw new PaymentsError("contract");
  return {
    checkoutId: id,
    subscriptionId: v.subscriptionId,
    checkoutStatus: v.checkoutStatus,
    subscriptionStatus: v.subscriptionStatus,
    ...(v.provider === undefined ? {} : { provider: v.provider as string }),
    ...(v.planChange === undefined
      ? {}
      : { planChange: planChangeState(v.planChange) }),
    ...(v.checkoutUrl === undefined ? {} : { checkoutUrl: v.checkoutUrl }),
  } as CheckoutStatus;
}

function pendingChangeDetails(
  v: Record<string, unknown>,
): Partial<PlanChangeQuote> &
  Pick<PlanChangeState, "action" | "checkoutUrl" | "cancellationRequested"> {
  const quote = v.kind === undefined ? {} : planChangeQuote(v);
  if (
    (v.action !== undefined &&
      !["approve_subscription", "approve_payment", "none"].includes(
        String(v.action),
      )) ||
    (v.checkoutUrl !== undefined && !checkoutUrl(v.checkoutUrl)) ||
    (v.cancellationRequested !== undefined &&
      typeof v.cancellationRequested !== "boolean")
  )
    throw new PaymentsError("contract");
  return {
    ...quote,
    ...(v.cancellationRequested === undefined
      ? {}
      : { cancellationRequested: v.cancellationRequested as boolean }),
    ...(v.action === undefined
      ? {}
      : { action: v.action as PlanChangeState["action"] }),
    ...(v.checkoutUrl === undefined
      ? {}
      : { checkoutUrl: v.checkoutUrl as string | null }),
  };
}

function parseAttempt(v: unknown, id: string): CheckoutAttemptResponse {
  id = id.toLowerCase();
  if (
    !record(v) ||
    v.attemptId !== id ||
    !["pending", "processing", "ready", "rejected"].includes(
      String(v.status),
    ) ||
    !["checkout", "change_plan"].includes(String(v.operation)) ||
    typeof v.statusFresh !== "boolean" ||
    (v.provider !== undefined && !identifier(v.provider)) ||
    (v.checkoutId !== undefined && !uuid.test(String(v.checkoutId))) ||
    (v.subscriptionId !== undefined && !uuid.test(String(v.subscriptionId))) ||
    (v.checkoutUrl !== undefined && !checkoutUrl(v.checkoutUrl)) ||
    (v.statusCheckedAt !== undefined && !date(v.statusCheckedAt)) ||
    (v.retryAfterSeconds !== undefined &&
      (!count(v.retryAfterSeconds) || v.retryAfterSeconds < 1)) ||
    (v.checkoutStatus !== undefined &&
      v.checkoutStatus !== null &&
      !statuses.includes(String(v.checkoutStatus))) ||
    (v.subscriptionStatus !== undefined &&
      v.subscriptionStatus !== null &&
      ![
        "pending",
        "active",
        "past_due",
        "suspended",
        "cancelled",
        "expired",
      ].includes(String(v.subscriptionStatus)))
  )
    throw new PaymentsError("contract");
  const change =
    v.planChange === undefined ? undefined : planChangeState(v.planChange);
  const canonicalUrl =
    change &&
    (["scheduled", "effective", "failed"].includes(change.state) ||
      change.action === "none" ||
      change.checkoutUrl === null ||
      (change.action === "approve_payment" && !change.checkoutUrl))
      ? undefined
      : (change?.checkoutUrl ?? v.checkoutUrl);
  return {
    attemptId: id,
    ...(v.provider === undefined ? {} : { provider: v.provider as string }),
    operation: v.operation as "checkout" | "change_plan",
    status: v.status as CheckoutAttemptResponse["status"],
    statusFresh: v.statusFresh,
    ...(identifier(v.planCode) ? { planCode: v.planCode } : {}),
    ...(identifier(v.planPriceCode) ? { planPriceCode: v.planPriceCode } : {}),
    ...(v.checkoutId === undefined
      ? {}
      : { checkoutId: v.checkoutId as string }),
    ...(v.subscriptionId === undefined
      ? {}
      : { subscriptionId: v.subscriptionId as string }),
    ...(typeof canonicalUrl === "string" ? { checkoutUrl: canonicalUrl } : {}),
    ...(change ? { planChange: change } : {}),
    ...(v.checkoutStatus === undefined
      ? {}
      : { checkoutStatus: v.checkoutStatus as string | null }),
    ...(v.subscriptionStatus === undefined
      ? {}
      : { subscriptionStatus: v.subscriptionStatus as string | null }),
    ...(typeof v.statusCheckedAt === "string"
      ? { statusCheckedAt: v.statusCheckedAt }
      : {}),
    ...(v.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: v.retryAfterSeconds as number }),
    ...(identifier(v.errorCode) ? { errorCode: v.errorCode } : {}),
  };
}
export function parsePaymentSnapshot(
  v: unknown,
  productCode: string,
  organizationId?: string,
): PaymentSnapshot {
  if (
    !record(v) ||
    !uuid.test(String(v.organizationId)) ||
    (organizationId !== undefined &&
      String(v.organizationId).toLowerCase() !==
        organizationId.toLowerCase()) ||
    v.productCode !== productCode ||
    !date(v.confirmedAt) ||
    v.confirmedAt === null ||
    Date.parse(v.confirmedAt) > Date.now() + 300000
  )
    throw new PaymentsError("contract");
  const verified = webhookInput(
    {
      type: "billing.license.updated",
      organizationId: v.organizationId,
      productCode,
      revision: v.revision,
      license: v.license,
      checkouts: [],
    },
    productCode,
  );
  const sub =
    v.subscription === null
      ? null
      : subscription(v.subscription, productCode, String(v.organizationId));
  if (
    verified.license.active &&
    (!sub ||
      verified.license.subscriptionId !== sub.id ||
      verified.license.planCode !== sub.planCode)
  )
    throw new PaymentsError("contract");
  return {
    organizationId: String(v.organizationId),
    productCode,
    revision: verified.revision as string,
    confirmedAt: v.confirmedAt,
    license: verified.license as unknown as PaymentSnapshot["license"],
    subscription: sub,
  };
}

/** Access from an optional copy expires; replaying an old revision never refreshes confirmedAt. */
export function snapshotAccess(
  snapshot: PaymentSnapshot | null | undefined,
): import("./contracts").LicenseAccess {
  if (!snapshot)
    return {
      active: false,
      source: null,
      validUntil: null,
      confirmedAt: null,
      subscriptionId: null,
      planCode: null,
      licenseStatus: null,
      reason: "not_confirmed",
      entitlements: {},
    };
  const verified = parsePaymentSnapshot(
    snapshot,
    snapshot.productCode,
    snapshot.organizationId,
  );
  const license = verified.license;
  const end = Math.min(
    Date.parse(verified.confirmedAt) + 86400000,
    license.validUntil === null ? Infinity : Date.parse(license.validUntil),
  );
  const active =
    license.active &&
    ["active", "grace"].includes(license.licenseStatus) &&
    end > Date.now();
  return {
    active,
    source: active ? "billing" : null,
    validUntil: active ? new Date(end).toISOString() : null,
    confirmedAt: verified.confirmedAt,
    subscriptionId: license.subscriptionId,
    planCode: license.planCode,
    licenseStatus: license.licenseStatus,
    reason: active
      ? "active"
      : license.active && end <= Date.now()
        ? "confirmation_expired"
        : "billing_inactive",
    entitlements: active
      ? { ...license.entitlements, features: license.features }
      : {},
  };
}
