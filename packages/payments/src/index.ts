import { MachineClient, MachineClientError } from "@hemia/auth";

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
  billingEmail?: string;
  successUrl?: string;
  cancelUrl?: string;
};
export type Checkout = {
  checkoutId: string;
  subscriptionId: string;
  checkoutUrl: string;
  status: string;
};
export type CheckoutStatus = {
  checkoutId: string;
  subscriptionId: string;
  checkoutStatus: string;
  subscriptionStatus: string;
  provider: string;
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
  active: boolean;
  productCode: string;
  planCode: string | null;
  licenseStatus: "active" | "grace" | "suspended" | "revoked";
  validUntil: string | null;
  seatsLimit: number;
  usageLimit: number | null;
  subscriptionId: string | null;
  features: Record<string, unknown>;
};

/** Safe diagnostic metadata only; never includes upstream payloads or credentials. */
export class PaymentsError extends Error {
  constructor(
    public readonly code:
      | "configuration"
      | "transport"
      | "authentication"
      | "http"
      | "contract"
      | "CHECKOUT_IN_PROGRESS",
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`Payments ${code}${status ? ` (${status})` : ""}`);
    this.name = "PaymentsError";
  }
}

const permissions = {
  catalog: "billing.integration.catalog.read",
  create: "billing.integration.checkout.create",
  status: "billing.integration.checkout.read",
  licenses: "billing.integration.licenses.read",
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
    permission: string,
    payload?: unknown,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await machine.request(
        "billing",
        `billing/integrations/v1/${path}`,
        {
          method: payload === undefined ? "GET" : "POST",
          scopes: [permission],
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
          (typeof input.legalAcceptanceId !== "string" || !uuid.test(input.legalAcceptanceId)))
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
        provider: "paypal",
        ...(input.legalAcceptanceId === undefined ? {} : { legalAcceptanceId: input.legalAcceptanceId }),
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
        !string(value.checkoutUrl)
      )
        throw new PaymentsError("contract");
      let url: URL;
      try {
        url = new URL(value.checkoutUrl);
      } catch {
        throw new PaymentsError("contract");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !["www.paypal.com", "www.sandbox.paypal.com"].includes(url.hostname)
      )
        throw new PaymentsError("contract");
      return {
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
      if (
        !record(value) ||
        value.checkoutId !== checkoutId ||
        !uuid.test(String(value.subscriptionId)) ||
        !statuses.includes(String(value.checkoutStatus)) ||
        ![
          "pending",
          "active",
          "past_due",
          "suspended",
          "cancelled",
          "expired",
        ].includes(String(value.subscriptionStatus)) ||
        value.provider !== "paypal"
      )
        throw new PaymentsError("contract");
      return {
        checkoutId,
        subscriptionId: value.subscriptionId as string,
        checkoutStatus: value.checkoutStatus as string,
        subscriptionStatus: value.subscriptionStatus as string,
        provider: value.provider,
      };
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
          !["active", "grace", "suspended", "revoked"].includes(
            String(value.licenseStatus),
          ) ||
          !date(value.validUntil) ||
          !count(value.seatsLimit) ||
          !(value.usageLimit === null || count(value.usageLimit)) ||
          !(
            value.subscriptionId === null ||
            uuid.test(String(value.subscriptionId))
          ) ||
          !record(value.features)
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
