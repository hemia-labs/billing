import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  createPaymentsClient,
  PaymentsError,
  type Checkout,
  type CheckoutInput,
  type Subscription,
  type PlanChangeState,
} from "../index";
import {
  PAYMENTS_OPTIONS,
  type CheckoutAttemptResponse,
  type CancelSubscriptionRequest,
  type CreateCheckoutAttemptInput,
  type LicenseAccess,
  type PaymentsContext,
  type PaymentsRuntimeOptions,
  type PaymentsOperation,
} from "./types";
import { PaymentsStorage, type AttemptRow } from "./storage";
import {
  attemptInput,
  cancellationInput,
  context,
  endpoint,
  uuid,
  webhookInput,
} from "./validation";
@Injectable()
export class PaymentsService {
  readonly client;
  constructor(
    @Inject(PAYMENTS_OPTIONS) readonly options: PaymentsRuntimeOptions,
    private readonly storage: PaymentsStorage,
  ) {
    this.client = createPaymentsClient({
      ...options.connection,
      clientSecret: options.clientSecret,
    });
    const r = options.receiver;
    if (!options.dataSource || typeof options.authorize !== "function" || !r)
      throw new Error("Invalid payments module configuration");
    endpoint(r.jwksUrl, options.connection.allowHttpLoopback === true);
    endpoint(r.introspectionUrl, options.connection.allowHttpLoopback === true);
  }
  async authorize(request: unknown, operation: PaymentsOperation) {
    const c = await this.options.authorize(request, operation);
    context(c);
    return c;
  }
  ready() {
    return this.storage.ready();
  }
  async listPlans(c: PaymentsContext) {
    context(c);
    try {
      return await this.client.catalog.listPlans();
    } catch {
      throw new ServiceUnavailableException("Payments catalog unavailable");
    }
  }
  async getSubscription(c: PaymentsContext): Promise<Subscription | null> {
    context(c);
    try {
      const current = await this.client.subscriptions.current(c.organizationId);
      if (!current?.pendingPlanChange?.checkoutId) return current;
      const attempts: { id: string; checkout_url: string | null }[] =
        await this.storage.transaction({ kind: "user", context: c }, (m) =>
          m.query(
            "SELECT id,checkout_url FROM public.payments_checkout_attempts WHERE organization_id=$1 AND product_code=$2 AND subject_id=$3 AND checkout_id=$4 AND request_payload->>'operation'='change_plan' ORDER BY created_at DESC LIMIT 1",
            [
              c.organizationId,
              this.options.connection.productCode,
              c.subjectId,
              current.pendingPlanChange!.checkoutId,
            ],
          ),
        );
      const attempt = attempts[0];
      return attempt
        ? {
            ...current,
            pendingPlanChange: {
              ...current.pendingPlanChange,
              attemptId: attempt.id,
              ...(attempt.checkout_url
                ? { checkoutUrl: attempt.checkout_url }
                : {}),
            },
          }
        : current;
    } catch {
      throw new ServiceUnavailableException(
        "Subscription management unavailable",
      );
    }
  }
  async cancelSubscription(
    c: PaymentsContext,
    input: CancelSubscriptionRequest,
  ) {
    context(c);
    const dto = cancellationInput(input);
    const current = await this.getSubscription(c);
    if (!current) throw new NotFoundException("Subscription not found");
    if (current.id !== dto.expectedSubscriptionId)
      throw new ConflictException("SUBSCRIPTION_CHANGED");
    try {
      const result = await this.client.subscriptions.cancel(current.id, {
        idempotencyKey: dto.idempotencyKey,
        ...(dto.reason === undefined ? {} : { reason: dto.reason }),
        actorUserId: c.subjectId,
      });
      if (result.organizationId !== c.organizationId)
        throw new PaymentsError("contract");
      return result;
    } catch (error) {
      if (error instanceof PaymentsError && error.status === 409)
        throw new ConflictException("SUBSCRIPTION_OPERATION_CONFLICT");
      throw new ServiceUnavailableException(
        "Subscription cancellation could not be confirmed; retry the same request",
      );
    }
  }
  async authorizeAttempt(request: unknown, id: string) {
    const c = await this.authorize(request, "checkout.manage");
    if (!uuid(id)) throw new BadRequestException("Invalid attempt ID");
    const row = await this.storage.transaction(
      { kind: "user", context: c },
      (m) => this.storage.byId(m, c.organizationId, id),
    );
    if (!row || row.subject_id !== c.subjectId)
      throw new NotFoundException("Checkout attempt not found");
    if (row.request_payload.operation === "change_plan") {
      const managed = await this.authorize(request, "subscription.manage");
      if (
        managed.organizationId !== c.organizationId ||
        managed.subjectId !== c.subjectId
      )
        throw new ConflictException("Payments context changed");
    }
    return c;
  }
  async integrationStatus() {
    await this.storage.ready();
    try {
      await this.client.catalog.listPlans();
    } catch {
      throw new ServiceUnavailableException("Payments integration unavailable");
    }
    const c = this.options.connection;
    return {
      ready: true,
      clientId: c.clientId,
      productCode: c.productCode,
      connection: {
        issuer: c.issuer,
        tokenUrl: c.tokenUrl,
        clientId: c.clientId,
        baseUrl: c.baseUrl,
        audience: c.audience,
        resource: c.resource,
        productCode: c.productCode,
        successUrl: c.successUrl,
        cancelUrl: c.cancelUrl,
        allowHttpLoopback: c.allowHttpLoopback,
        tokenTimeoutMs: c.tokenTimeoutMs,
        requestTimeoutMs: c.requestTimeoutMs,
        ...(c.receiver
          ? {
              receiver: {
                audience: c.receiver.audience,
                billingClientId: c.receiver.billingClientId,
                consoleClientId: c.receiver.consoleClientId,
              },
            }
          : {}),
        ...(c.legal
          ? {
              legal: {
                baseUrl: c.legal.baseUrl,
                audience: c.legal.audience,
                resource: c.legal.resource,
                verificationClientId: c.legal.verificationClientId,
              },
            }
          : {}),
      },
      ...(this.options.legal
        ? {
            legalConnection: {
              baseUrl: this.options.legal.baseUrl,
              identityIssuer: c.issuer,
              jwksUrl: this.options.receiver.jwksUrl,
            },
          }
        : {}),
    };
  }
  async createAttempt(
    c: PaymentsContext,
    input: CreateCheckoutAttemptInput,
    operation: "checkout" | "change_plan" = "checkout",
  ): Promise<CheckoutAttemptResponse> {
    context(c);
    const dto = attemptInput(input);
    if (
      operation === "change_plan"
        ? !uuid(dto.expectedSubscriptionId)
        : dto.expectedSubscriptionId !== undefined
    )
      throw new BadRequestException("Invalid expected subscription");
    const product = this.options.connection.productCode;
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          c.organizationId,
          c.subjectId,
          product,
          dto.planCode,
          dto.planPriceCode,
          dto.legalAcceptanceId,
          ...(operation === "change_plan"
            ? [operation, dto.expectedSubscriptionId]
            : []),
        ]),
      )
      .digest("hex");
    const reserve = async (payload?: Record<string, unknown>, id?: string) =>
      this.storage.transaction({ kind: "user", context: c }, async (m) => {
        await m.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          JSON.stringify([
            "payments.checkout",
            c.organizationId,
            product,
            dto.idempotencyKey,
          ]),
        ]);
        const rows: AttemptRow[] = await m.query(
          "SELECT * FROM public.payments_checkout_attempts WHERE organization_id=$1 AND product_code=$2 AND idempotency_key=$3 FOR UPDATE",
          [c.organizationId, product, dto.idempotencyKey],
        );
        const existing = rows[0];
        if (existing) {
          if (
            existing.subject_id !== c.subjectId ||
            existing.request_hash !== hash
          )
            throw new ConflictException("IDEMPOTENCY_KEY_REUSED");
          return existing;
        }
        if (!payload || !id) return null;
        const inserted: AttemptRow[] = await m.query(
          `INSERT INTO public.payments_checkout_attempts(id,organization_id,subject_id,product_code,idempotency_key,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'pending') RETURNING *`,
          [
            id,
            c.organizationId,
            c.subjectId,
            product,
            dto.idempotencyKey,
            hash,
            JSON.stringify(payload),
          ],
        );
        return inserted[0];
      });
    const existing = await reserve();
    if (existing) return this.requestCheckout(c, existing);
    const plans = await this.listPlans(c);
    if (
      !plans.some(
        (p) =>
          p.code === dto.planCode &&
          p.prices.some((price) => price.code === dto.planPriceCode),
      )
    )
      throw new ConflictException("BILLING_PLAN_CHANGED");
    if (operation === "checkout") {
      let paid;
      try {
        paid = await this.client.licenses.resolve(c.organizationId);
      } catch {
        throw new ServiceUnavailableException(
          "Current paid access could not be verified",
        );
      }
      if (paid.active)
        throw new ConflictException("SUBSCRIPTION_CHANGE_REQUIRED");
    }
    const source =
      operation === "change_plan" ? await this.getSubscription(c) : null;
    if (source && source.id !== dto.expectedSubscriptionId)
      throw new ConflictException("SUBSCRIPTION_CHANGED");
    if (
      operation === "change_plan" &&
      (!source ||
        !["active", "past_due"].includes(source.status) ||
        source.cancelAtPeriodEnd ||
        source.cancellation)
    )
      throw new ConflictException("SUBSCRIPTION_CANNOT_CHANGE");
    if (
      source &&
      source.planCode === dto.planCode &&
      source.planPriceCode === dto.planPriceCode
    )
      throw new ConflictException("SUBSCRIPTION_PLAN_UNCHANGED");
    const id = randomUUID();
    const urls = (await this.options.returnUrls?.(c, id)) ?? {
      successUrl: this.options.connection.successUrl,
      cancelUrl: this.options.connection.cancelUrl,
    };
    const payload = {
      ...dto,
      organizationId: c.organizationId,
      userId: c.subjectId,
      productCode: product,
      operation,
      ...(source ? { sourceSubscriptionId: source.id } : {}),
      ...urls,
    };
    if (!urls.successUrl || !urls.cancelUrl)
      throw new ServiceUnavailableException(
        "Checkout return URLs are not configured",
      );
    for (const [key, value] of Object.entries(urls)) {
      let u: URL;
      try {
        u = new URL(value!);
        if (
          u.username ||
          u.password ||
          u.hash ||
          (u.protocol !== "https:" &&
            !(
              this.options.connection.allowHttpLoopback &&
              process.env.NODE_ENV !== "production" &&
              u.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
            ))
        )
          throw new Error();
        const configured =
          this.options.connection[key as "successUrl" | "cancelUrl"];
        if (configured && u.origin !== new URL(configured).origin)
          throw new Error();
      } catch {
        throw new ServiceUnavailableException("Invalid checkout return URL");
      }
    }
    const row = await reserve(payload, id);
    if (!row)
      throw new ServiceUnavailableException("Checkout reservation failed");
    return this.requestCheckout(c, row);
  }
  async getAttempt(c: PaymentsContext, id: string) {
    context(c);
    if (!uuid(id)) throw new BadRequestException("Invalid attempt ID");
    const row = await this.storage.transaction(
      { kind: "user", context: c },
      (m) => this.storage.byId(m, c.organizationId, id),
    );
    if (!row) throw new NotFoundException("Checkout attempt not found");
    if (
      row.request_payload.operation === "change_plan" &&
      row.status === "ready" &&
      row.checkout_id &&
      row.subscription_id
    ) {
      let status;
      try {
        status = await this.client.checkout.status(row.checkout_id);
      } catch {
        return {
          ...this.receipt(row),
          statusFresh: false,
          errorCode: "BILLING_STATUS_UNAVAILABLE",
        };
      }
      if (
        status.checkoutId !== row.checkout_id ||
        status.subscriptionId !== row.subscription_id ||
        !status.planChange
      )
        throw new BadGatewayException("Invalid plan change status");
      return this.storage.transaction(
        { kind: "user", context: c },
        async (m) => {
          await m.query(
            `UPDATE public.payments_checkout_attempts SET checkout_status=$4,subscription_status=$5,status_checked_at=clock_timestamp(),request_payload=jsonb_set(request_payload,'{planChange}',$6::jsonb),updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND product_code=$3 AND checkout_id=$7 AND subscription_id=$8 AND status_checked_at IS NOT DISTINCT FROM $9::timestamptz`,
            [
              row.id,
              c.organizationId,
              this.options.connection.productCode,
              status.checkoutStatus,
              status.subscriptionStatus,
              JSON.stringify(status.planChange),
              row.checkout_id,
              row.subscription_id,
              row.status_checked_at,
            ],
          );
          const current = await this.storage.byId(m, c.organizationId, row.id);
          if (!current)
            throw new NotFoundException("Checkout attempt not found");
          return this.receipt(current);
        },
      );
    }
    if (
      row.status === "ready" &&
      row.checkout_id &&
      row.subscription_id &&
      row.status_checked_at === null
    ) {
      // A webhook can arrive before the checkout IDs have been saved locally.
      // Repair by reading Billing; never repeat a purchase from a GET request.
      let status;
      try {
        status = await this.client.checkout.status(row.checkout_id);
      } catch {
        return {
          ...this.receipt(row),
          errorCode: "BILLING_STATUS_UNAVAILABLE",
        };
      }
      if (
        status.checkoutId !== row.checkout_id ||
        status.subscriptionId !== row.subscription_id
      )
        throw new BadGatewayException("Inconsistent checkout status");
      return this.storage.transaction(
        { kind: "user", context: c },
        async (manager) => {
          await manager.query(
            `UPDATE public.payments_checkout_attempts SET checkout_status=$4,subscription_status=$5,status_checked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND product_code=$3 AND status_checked_at IS NULL AND checkout_id=$6 AND subscription_id=$7`,
            [
              row.id,
              c.organizationId,
              this.options.connection.productCode,
              status.checkoutStatus,
              status.subscriptionStatus,
              row.checkout_id,
              row.subscription_id,
            ],
          );
          const current = await this.storage.byId(
            manager,
            c.organizationId,
            row.id,
          );
          if (!current)
            throw new NotFoundException("Checkout attempt not found");
          return this.receipt(current);
        },
      );
    }
    return this.receipt(row);
  }
  async retryAttempt(c: PaymentsContext, id: string) {
    context(c);
    if (!uuid(id)) throw new BadRequestException("Invalid attempt ID");
    const row = await this.storage.transaction(
      { kind: "user", context: c },
      (m) => this.storage.byId(m, c.organizationId, id),
    );
    if (!row) throw new NotFoundException("Checkout attempt not found");
    if (row.subject_id !== c.subjectId)
      throw new ConflictException("IDEMPOTENCY_KEY_REUSED");
    return this.requestCheckout(c, row);
  }
  private cached(row: AttemptRow) {
    if (row.status === "ready") return this.receipt(row);
    if (row.status === "rejected")
      throw new UnprocessableEntityException(
        row.error_code ?? "BILLING_CHECKOUT_REJECTED",
      );
  }
  private async requestCheckout(
    c: PaymentsContext,
    row: AttemptRow,
  ): Promise<CheckoutAttemptResponse> {
    const cached = this.cached(row);
    if (cached) return cached;
    if (row.request_payload.productCode !== this.options.connection.productCode)
      throw new ServiceUnavailableException("Checkout product changed");
    let result: Checkout | undefined;
    let failure: unknown;
    let planChange: PlanChangeState | undefined;
    try {
      if (row.request_payload.operation === "change_plan") {
        if (!uuid(row.request_payload.sourceSubscriptionId))
          throw new PaymentsError("contract");
        const changed = await this.client.subscriptions.changePlan(
          row.request_payload.sourceSubscriptionId,
          row.request_payload as unknown as CheckoutInput,
        );
        planChange = { state: changed.state, effectiveAt: changed.effectiveAt };
        result = {
          checkoutId: changed.checkoutId,
          subscriptionId: changed.newSubscriptionId,
          checkoutUrl: changed.checkoutUrl,
          status: "created",
        };
      } else {
        result = await this.client.checkout.create(
          row.request_payload as unknown as CheckoutInput,
        );
      }
    } catch (e) {
      failure = e;
    }
    return this.storage.transaction({ kind: "user", context: c }, async (m) => {
      const current = await this.storage.byId(
        m,
        c.organizationId,
        row.id,
        true,
      );
      if (!current) throw new NotFoundException("Checkout attempt not found");
      if (result) {
        if (
          current.status === "ready" &&
          (current.checkout_id !== result.checkoutId ||
            current.subscription_id !== result.subscriptionId)
        )
          throw new BadGatewayException("Inconsistent checkout receipt");
        if (current.status === "ready") return this.receipt(current);
        const saved: AttemptRow[] = await m.query(
          `WITH changed AS (UPDATE public.payments_checkout_attempts SET status='ready',checkout_id=$4,subscription_id=$5,checkout_url=$6,checkout_status=CASE WHEN status_checked_at IS NULL THEN $7 ELSE checkout_status END,request_payload=CASE WHEN $8::jsonb IS NULL THEN request_payload ELSE jsonb_set(request_payload,'{planChange}',$8::jsonb) END,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND product_code=$3 RETURNING *) SELECT * FROM changed`,
          [
            row.id,
            c.organizationId,
            this.options.connection.productCode,
            result.checkoutId,
            result.subscriptionId,
            result.checkoutUrl,
            result.status,
            planChange ? JSON.stringify(planChange) : null,
          ],
        );
        return this.receipt(saved[0]);
      }
      const now = this.cached(current);
      if (now) return now;
      const error = failure instanceof PaymentsError ? failure : undefined;
      if (error?.code === "CHECKOUT_IN_PROGRESS")
        return {
          ...this.receipt(current),
          status: "processing",
          retryAfterSeconds: error.retryAfterSeconds ?? 5,
        };
      if (error?.code === "contract")
        throw new BadGatewayException("Invalid checkout response");
      if (error?.code === "configuration")
        throw new ServiceUnavailableException(
          "Checkout configuration unavailable",
        );
      if (
        error?.status &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 403, 408, 429].includes(error.status)
      ) {
        await m.query(
          `UPDATE public.payments_checkout_attempts SET status='rejected',error_code='BILLING_CHECKOUT_REJECTED',updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND product_code=$3`,
          [row.id, c.organizationId, this.options.connection.productCode],
        );
        return {
          ...this.receipt(current),
          status: "rejected",
          errorCode: "BILLING_CHECKOUT_REJECTED",
        };
      }
      return {
        ...this.receipt(current),
        status: "pending",
        errorCode:
          error?.status === 401
            ? "BILLING_SERVICE_UNAUTHORIZED"
            : error?.status === 403
              ? "BILLING_SERVICE_FORBIDDEN"
              : "BILLING_TEMPORARILY_UNAVAILABLE",
        retryAfterSeconds: error?.retryAfterSeconds ?? 5,
      };
    });
  }
  private receipt(r: AttemptRow): CheckoutAttemptResponse {
    return {
      attemptId: r.id,
      status: r.status,
      ...(r.request_payload.operation === "change_plan" &&
      r.request_payload.planChange
        ? { planChange: r.request_payload.planChange as PlanChangeState }
        : {}),
      ...(typeof r.request_payload.planCode === "string"
        ? { planCode: r.request_payload.planCode }
        : {}),
      ...(typeof r.request_payload.planPriceCode === "string"
        ? { planPriceCode: r.request_payload.planPriceCode }
        : {}),
      ...(r.checkout_id ? { checkoutId: r.checkout_id } : {}),
      ...(r.subscription_id ? { subscriptionId: r.subscription_id } : {}),
      ...(r.checkout_url ? { checkoutUrl: r.checkout_url } : {}),
      ...(r.checkout_status ? { checkoutStatus: r.checkout_status } : {}),
      ...(r.subscription_status
        ? { subscriptionStatus: r.subscription_status }
        : {}),
      ...(r.status_checked_at
        ? { statusCheckedAt: new Date(r.status_checked_at).toISOString() }
        : {}),
      statusFresh: r.status_checked_at !== null,
      ...(r.error_code ? { errorCode: r.error_code } : {}),
    };
  }
  async getLicense(c: PaymentsContext): Promise<LicenseAccess> {
    context(c);
    return this.storage.transaction({ kind: "user", context: c }, async (m) => {
      const rows: {
        license: Record<string, unknown>;
        confirmed_at: Date | string;
      }[] = await m.query(
        "SELECT license,confirmed_at FROM public.payments_licenses WHERE organization_id=$1 AND product_code=$2",
        [c.organizationId, this.options.connection.productCode],
      );
      const row = rows[0],
        l = row?.license;
      const confirmed = row ? new Date(row.confirmed_at).getTime() : null;
      const end =
        confirmed === null
          ? null
          : Math.min(
              confirmed + 86400000,
              typeof l?.validUntil === "string"
                ? Date.parse(l.validUntil)
                : Infinity,
            );
      const active =
        l?.active === true &&
        ["active", "grace"].includes(String(l.licenseStatus)) &&
        end !== null &&
        end > Date.now();
      return {
        active,
        source: active ? "billing" : null,
        validUntil: active ? new Date(end).toISOString() : null,
        confirmedAt:
          confirmed === null ? null : new Date(confirmed).toISOString(),
        subscriptionId:
          typeof l?.subscriptionId === "string" ? l.subscriptionId : null,
        planCode: typeof l?.planCode === "string" ? l.planCode : null,
        licenseStatus:
          typeof l?.licenseStatus === "string" ? l.licenseStatus : null,
        reason: active
          ? "active"
          : l?.active && end !== null && end <= Date.now()
            ? "confirmation_expired"
            : row
              ? "billing_inactive"
              : "not_confirmed",
        entitlements: active
          ? {
              ...((l?.entitlements as Record<string, unknown>) ?? {}),
              features: l?.features ?? {},
            }
          : {},
      };
    });
  }
  async receiveLicense(input: unknown) {
    const e = webhookInput(input, this.options.connection.productCode);
    return this.storage.transaction({ kind: "webhook" }, async (m) => {
      const rows: { applied: boolean }[] = await m.query(
        "SELECT public.payments_apply_license($1::uuid,$2::text,$3::bigint,$4::jsonb,$5::jsonb) AS applied",
        [
          e.organizationId,
          e.productCode,
          e.revision,
          JSON.stringify(e.license),
          JSON.stringify(e.checkouts),
        ],
      );
      return { received: true, applied: rows[0].applied };
    });
  }
}
