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
  type ResumeRenewalRequest,
  type ChangeRenewalPlanRequest,
} from "./types";
import {
  context,
  uuid,
  attemptInput,
  cancellationInput,
  resumeRenewalInput,
  changeRenewalPlanInput,
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
    let current = await this.call(() =>
      this.client.subscriptions.current(c.organizationId),
    );
    if (current?.pendingCheckoutAttemptId) {
      const { pendingCheckoutAttemptId, ...unbound } = current;
      current = unbound;
      if (current.status === "pending" && uuid(pendingCheckoutAttemptId)) {
        try {
          const attempt = await this.client.attempts.get(
            pendingCheckoutAttemptId,
            this.buyer(c),
          );
          if (
            attempt.operation === "checkout" &&
            attempt.subscriptionId === current.id &&
            attempt.planCode === current.planCode &&
            attempt.planPriceCode === current.planPriceCode
          )
            current = { ...current, pendingCheckoutAttemptId };
        } catch (error) {
          if (!(error instanceof PaymentsError && error.status === 404))
            return this.call(async () => {
              throw error;
            });
        }
      }
    }
    if (current?.pendingRenewal) {
      const renewal = current.pendingRenewal;
      const { attemptId, checkoutUrl: _renewalUrl, ...unbound } = renewal;
      current = { ...current, pendingRenewal: { ...unbound, checkoutUrl: null } };
      if (attemptId && uuid(attemptId)) {
        try {
          const attempt = await this.client.attempts.get(attemptId, this.buyer(c));
          const checked = attempt.renewalResume;
          if (attempt.operation === "resume_renewal" && checked &&
              checked.sourceSubscriptionId === current.id &&
              checked.sourceSubscriptionId === renewal.sourceSubscriptionId &&
              attempt.subscriptionId === renewal.subscriptionId &&
              attempt.planCode === current.planCode && attempt.planPriceCode === current.planPriceCode &&
              checked.effectiveAt === renewal.effectiveAt && checked.currency === renewal.currency &&
              checked.recurringAmount === renewal.recurringAmount) {
            const terminal = ["effective", "failed"].includes(renewal.state);
            const regression = renewal.state === "scheduled" && ["preparing", "awaiting_approval"].includes(checked.state);
            const canonical = attempt.statusFresh && !terminal && !regression ? checked : renewal;
            current = { ...current, pendingRenewal: { ...canonical,
              ...(renewal.planCode ? { planCode: renewal.planCode } : {}),
              ...(renewal.planPriceCode ? { planPriceCode: renewal.planPriceCode } : {}),
              subscriptionId: renewal.subscriptionId, attemptId,
              checkoutUrl: !terminal && !regression && attempt.statusFresh && ["preparing", "awaiting_approval"].includes(checked.state)
                ? attempt.checkoutUrl ?? null : null } };
          }
        } catch (error) {
          if (!(error instanceof PaymentsError && error.status === 404))
            return this.call(async () => { throw error; });
        }
      }
    }
    if (current?.pendingRenewalPlanChange) {
      const revision = current.pendingRenewalPlanChange;
      const { attemptId, checkoutUrl: _revisionUrl, ...unbound } = revision;
      current = { ...current, pendingRenewalPlanChange: { ...unbound, checkoutUrl: null } };
      if (attemptId && uuid(attemptId)) {
        try {
          const attempt = await this.client.attempts.get(attemptId, this.buyer(c));
          const checked = attempt.renewalPlanChange;
          if (attempt.operation === "change_renewal_plan" && checked &&
              checked.sourceSubscriptionId === current.id && checked.sourceSubscriptionId === revision.sourceSubscriptionId &&
              checked.renewalSubscriptionId === revision.renewalSubscriptionId &&
              current.pendingRenewal?.subscriptionId === checked.renewalSubscriptionId &&
              attempt.subscriptionId === checked.renewalSubscriptionId && attempt.checkoutId === revision.checkoutId &&
              attempt.planCode === revision.targetPlanCode && attempt.planPriceCode === revision.targetPlanPriceCode &&
              checked.targetPlanCode === revision.targetPlanCode && checked.targetPlanPriceCode === revision.targetPlanPriceCode &&
              checked.effectiveAt === revision.effectiveAt && checked.recurringAmount === revision.recurringAmount && checked.currency === revision.currency) {
            const lateRestoration = revision.state === "failed" && revision.cancellationRequested &&
              checked.cancellationRequested && checked.state === "awaiting_approval" && checked.action === "approve_subscription";
            const terminal = revision.state === "effective" || revision.state === "failed" && !lateRestoration;
            const regression = revision.cancellationRequested && !checked.cancellationRequested ||
              revision.state === "scheduled" && !checked.cancellationRequested && ["preparing", "awaiting_approval"].includes(checked.state);
            const canonical = attempt.statusFresh && !terminal && !regression ? checked : revision;
            const noAction = terminal || ["effective", "failed"].includes(canonical.state) || !attempt.statusFresh || regression || canonical.action === "none" ||
              canonical.state === "scheduled" && !canonical.cancellationRequested;
            current = { ...current, pendingRenewalPlanChange: { ...canonical, attemptId, checkoutId: revision.checkoutId,
              checkoutUrl: noAction ? null : attempt.checkoutUrl ?? null } };
          }
        } catch (error) {
          if (!(error instanceof PaymentsError && error.status === 404))
            return this.call(async () => { throw error; });
        }
      }
    }
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
    const checked = attempt.planChange;
    const terminal = ["effective", "failed"].includes(change.state) ||
      (change.state === "scheduled" && !change.cancellationRequested && !checked?.cancellationRequested);
    const canonical =
      !terminal &&
      attempt.statusFresh &&
      checked &&
      !(change.cancellationRequested && !checked.cancellationRequested) &&
      !(
        change.action === "approve_payment" &&
        checked.action === "approve_subscription" &&
        !checked.cancellationRequested
      )
        ? { ...change, ...checked }
        : change;
    const noAction =
      ["effective", "failed"].includes(canonical.state) ||
      (canonical.state === "scheduled" && !canonical.cancellationRequested) ||
      canonical.action === "none";
    const checkoutUrl = noAction
      ? null
      : canonical.action === "approve_payment"
        ? (canonical.checkoutUrl ?? null)
        : (canonical.checkoutUrl ??
          (checked?.action !== "approve_payment" &&
          !["effective", "failed"].includes(checked?.state ?? "") &&
          (checked?.state !== "scheduled" || checked.cancellationRequested)
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
  async resumeRenewal(c: PaymentsContext, input: ResumeRenewalRequest) {
    context(c);
    const dto = resumeRenewalInput(input);
    const current = await this.getSubscription(c);
    if (!current) throw new NotFoundException("Subscription not found");
    if (current.id !== dto.expectedSubscriptionId)
      throw new ConflictException("SUBSCRIPTION_CHANGED");
    const planPriceCode = current.planPriceCode;
    if (!planPriceCode) throw new ConflictException("Subscription price unavailable");
    const urls = await this.options.returnUrls?.(c, dto.idempotencyKey);
    return this.call(() => this.client.attempts.create({
      ...dto, operation: "resume_renewal", organizationId: c.organizationId, userId: c.subjectId,
      planCode: current.planCode, planPriceCode, ...urls,
    }));
  }
  async changeRenewalPlan(c: PaymentsContext, input: ChangeRenewalPlanRequest) {
    context(c);
    const dto = changeRenewalPlanInput(input);
    const current = await this.getSubscription(c);
    if (!current) throw new NotFoundException("Subscription not found");
    if (current.id !== dto.expectedSubscriptionId || current.pendingRenewal?.subscriptionId !== dto.expectedRenewalSubscriptionId)
      throw new ConflictException("SUBSCRIPTION_CHANGED");
    const urls = await this.options.returnUrls?.(c, dto.idempotencyKey);
    return this.call(() => this.client.attempts.create({
      idempotencyKey: dto.idempotencyKey, operation: "change_renewal_plan", organizationId: c.organizationId, userId: c.subjectId,
      expectedSubscriptionId: current.id, expectedRenewalSubscriptionId: dto.expectedRenewalSubscriptionId,
      planCode: dto.targetPlanCode, planPriceCode: dto.targetPlanPriceCode, ...urls,
    }));
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
    if (attempt.operation === "change_plan" || attempt.operation === "resume_renewal" || attempt.operation === "change_renewal_plan" || attempt.planChange || attempt.renewalResume || attempt.renewalPlanChange) {
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
    const compatibility = await this.call(() =>
      this.client.verifyCompatibility(),
    );
    await this.call(() => this.client.catalog.listPlans());
    const c = this.options.connection;
    return {
      ready: true,
      compatibility,
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
