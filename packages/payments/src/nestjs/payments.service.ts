import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import {
  createPaymentsClient,
  createPaymentsReceiver,
  parsePaymentSnapshot,
  PaymentsError,
  type Subscription,
} from "../index";
import {
  PAYMENTS_OPTIONS,
  type PaymentsRuntimeOptions,
  type PaymentsContext,
  type PaymentsOperation,
  type CreateCheckoutAttemptInput,
  type CancelSubscriptionRequest,
} from "./types";
import {
  context,
  uuid,
  attemptInput,
  cancellationInput,
  webhookInput,
} from "./validation";
@Injectable()
export class PaymentsService {
  readonly client;
  readonly receiver;
  constructor(
    @Inject(PAYMENTS_OPTIONS) readonly options: PaymentsRuntimeOptions,
  ) {
    const config = {
      ...options.connection,
      clientSecret: options.clientSecret,
    };
    this.client = createPaymentsClient(config);
    this.receiver = createPaymentsReceiver(config, {
      receiver: options.receiver,
      onSnapshot: options.onSnapshot,
    });
  }
  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PaymentsError)
        throw new HttpException(
          error.message,
          error.status ?? (error.code === "contract" ? 502 : 503),
        );
      throw error;
    }
  }
  async authorize(request: unknown, operation: PaymentsOperation) {
    const c = await this.options.authorize(request, operation);
    context(c);
    return c;
  }
  ready() {
    return { ready: true, authority: "billing" };
  }
  async listPlans(c: PaymentsContext) {
    context(c);
    return this.call(() => this.client.catalog.listPlans());
  }
  async getSubscription(c: PaymentsContext): Promise<Subscription | null> {
    context(c);
    const current = await this.call(() =>
      this.client.subscriptions.current(c.organizationId),
    );
    const change = current?.pendingPlanChange;
    if (!current || !change) return current;
    const { attemptId, checkoutUrl: _oldUrl, ...unbound } = change;
    const unavailable = {
      ...current,
      pendingPlanChange: { ...unbound, checkoutUrl: null },
    };
    if (!attemptId || !uuid(attemptId)) return unavailable;
    let attempt;
    try {
      attempt = await this.client.attempts.get(attemptId, this.buyer(c));
    } catch (error) {
      // Historical consumer-local IDs and another buyer's attempts are never replayed or guessed.
      if (error instanceof PaymentsError && error.status === 404)
        return unavailable;
      return this.call(async () => {
        throw error;
      });
    }
    if (
      attempt.operation !== "change_plan" ||
      attempt.checkoutId !== change.checkoutId ||
      attempt.subscriptionId !== current.id ||
      attempt.planCode !== change.targetPlanCode ||
      attempt.planPriceCode !== change.targetPlanPriceCode
    )
      return unavailable;
    const terminal = ["scheduled", "effective", "failed"].includes(
      change.state,
    );
    const checked = attempt.planChange;
    const canonical =
      !terminal &&
      attempt.statusFresh &&
      checked &&
      !(
        change.action === "approve_payment" &&
        checked.action === "approve_subscription" &&
        !checked.cancellationRequested
      )
        ? { ...change, ...checked }
        : change;
    const noAction =
      ["scheduled", "effective", "failed"].includes(canonical.state) ||
      canonical.action === "none";
    const checkoutUrl = noAction
      ? null
      : canonical.action === "approve_payment"
        ? (canonical.checkoutUrl ?? null)
        : (canonical.checkoutUrl ??
          (checked?.action !== "approve_payment" &&
          !["scheduled", "effective", "failed"].includes(checked?.state ?? "")
            ? (attempt.checkoutUrl ?? null)
            : null));
    return {
      ...current,
      pendingPlanChange: { ...canonical, attemptId, checkoutUrl },
    };
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
    return this.call(() =>
      this.client.subscriptions.cancel(current.id, {
        idempotencyKey: dto.idempotencyKey,
        actorUserId: c.subjectId,
        ...(dto.reason === undefined ? {} : { reason: dto.reason }),
      }),
    );
  }
  async createAttempt(
    c: PaymentsContext,
    input: CreateCheckoutAttemptInput,
    operation: "checkout" | "change_plan" = "checkout",
  ) {
    context(c);
    const dto = attemptInput(input);
    if (
      operation === "change_plan"
        ? !uuid(dto.expectedSubscriptionId)
        : dto.expectedSubscriptionId !== undefined
    )
      throw new HttpException("Invalid expected subscription", 400);
    const urls = await this.options.returnUrls?.(c, dto.idempotencyKey);
    return this.call(() =>
      this.client.attempts.create({
        ...dto,
        organizationId: c.organizationId,
        userId: c.subjectId,
        operation,
        ...urls,
      }),
    );
  }
  async authorizeAttempt(request: unknown, id: string) {
    const c = await this.authorize(request, "checkout.manage");
    if (!uuid(id)) throw new HttpException("Invalid attempt ID", 400);
    const attempt = await this.getAttempt(c, id);
    if (attempt.operation === "change_plan" || attempt.planChange) {
      const managed = await this.authorize(request, "subscription.manage");
      if (
        managed.organizationId !== c.organizationId ||
        managed.subjectId !== c.subjectId
      )
        throw new ConflictException("Payments context changed");
    }
    return c;
  }
  private buyer(c: PaymentsContext) {
    context(c);
    return { organizationId: c.organizationId, userId: c.subjectId };
  }
  async getAttempt(c: PaymentsContext, id: string) {
    return this.call(() => this.client.attempts.get(id, this.buyer(c)));
  }
  async retryAttempt(c: PaymentsContext, id: string) {
    return this.call(() => this.client.attempts.retry(id, this.buyer(c)));
  }
  async confirmAttempt(c: PaymentsContext, id: string) {
    return this.call(() => this.client.attempts.confirm(id, this.buyer(c)));
  }
  async cancelAttempt(c: PaymentsContext, id: string) {
    return this.call(() => this.client.attempts.cancel(id, this.buyer(c)));
  }
  async planChangeQuote(
    c: PaymentsContext,
    input: { targetPlanCode: string; targetPlanPriceCode: string },
  ) {
    const source = await this.getSubscription(c);
    if (!source) throw new NotFoundException("Subscription not found");
    return this.call(() =>
      this.client.subscriptions.planChangeQuote(
        source.id,
        input.targetPlanCode,
        input.targetPlanPriceCode,
      ),
    );
  }
  async getSnapshot(c: PaymentsContext) {
    context(c);
    return this.call(() => this.client.snapshots.current(c.organizationId));
  }
  async getLicense(c: PaymentsContext) {
    context(c);
    const license = await this.call(() =>
      this.client.licenses.resolve(c.organizationId),
    );
    const confirmedAt = new Date().toISOString();
    const active =
      license.active &&
      ["active", "grace"].includes(license.licenseStatus) &&
      (!license.validUntil || Date.parse(license.validUntil) > Date.now());
    return {
      active,
      source: active ? ("billing" as const) : null,
      validUntil: active ? license.validUntil : null,
      confirmedAt,
      subscriptionId: license.subscriptionId,
      planCode: license.planCode,
      licenseStatus: license.licenseStatus,
      reason: active ? ("active" as const) : ("billing_inactive" as const),
      entitlements: active
        ? { ...license.entitlements, features: license.features }
        : {},
      ...(license.billing ? { billing: license.billing } : {}),
    };
  }

  async receiveLicense(input: unknown) {
    if (!this.options.onSnapshot)
      throw new NotFoundException("Local synchronization is disabled");
    webhookInput(input, this.options.connection.productCode);
    return this.call(async () => {
      const result = await this.options.onSnapshot!(
        parsePaymentSnapshot(input, this.options.connection.productCode),
      );
      if (!result || typeof result.applied !== "boolean")
        throw new PaymentsError("contract");
      return { received: true, applied: result.applied };
    });
  }
  async integrationStatus() {
    await this.client.catalog.listPlans();
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
        receiver: c.receiver,
        legal: c.legal,
      },
      synchronization: { enabled: !!this.options.onSnapshot },
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
}
