import {
  BadRequestException,
  Body,
  Controller,
  ExecutionContext,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  Res,
  SetMetadata,
  UnauthorizedException,
  NotFoundException,
  ServiceUnavailableException,
  UseGuards,
  UseFilters,
  type CanActivate,
} from "@nestjs/common";
import { PaymentsExceptionFilter } from "./errors";
import { Reflector } from "@nestjs/core";
import { PaymentsService } from "./payments.service";
import { PaymentsServiceTokens } from "./service-tokens";
import { PaymentsLegalService } from "./legal.service";
import {
  PAYMENTS_OPTIONS,
  SERVICE_AUTHENTICATED_METADATA,
  type CheckoutAttemptResponse,
  type PaymentsRuntimeOptions,
} from "./types";
import {
  acceptInput,
  cancellationInput,
  attemptInput,
  legalContextInput,
  prepareInput,
  planChangeQuoteInput,
} from "./validation";
const MACHINE_KIND = "hemia.payments.machine-kind";
const machine = (kind: "billing" | "console" | "legal") =>
  SetMetadata(MACHINE_KIND, kind);
const fresh = (v: string) =>
  /^\d{10}$/.test(v) && Math.abs(Date.now() / 1000 - Number(v)) <= 300;
@Injectable()
export class PaymentsMachineGuard implements CanActivate {
  constructor(
    @Inject(PAYMENTS_OPTIONS) private readonly options: PaymentsRuntimeOptions,
    private readonly tokens: PaymentsServiceTokens,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const kind = this.reflector.getAllAndOverride<string>(MACHINE_KIND, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (kind === "billing" && !this.options.onSnapshot)
      throw new NotFoundException("Local synchronization is disabled");
    if (kind === "legal" && !this.options.legal)
      throw new NotFoundException("Legal integration is disabled");
    const r = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    const token = /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(
      r.headers.authorization ?? "",
    )?.[1];
    if (!token) throw new UnauthorizedException();
    const timestamp = r.headers["x-billing-timestamp"] ?? "";
    if (kind === "billing" && !fresh(timestamp))
      throw new UnauthorizedException("Invalid webhook timestamp");
    const client =
      kind === "billing"
        ? this.options.receiver.billingClientId
        : kind === "console"
          ? this.options.receiver.consoleClientId
          : this.options.legal?.verificationClientId;
    if (!client || !this.options.receiver.audience)
      throw new ServiceUnavailableException(
        "Payments receiver is not configured",
      );
    const scope =
      kind === "billing"
        ? "billing.webhooks.deliver"
        : kind === "console"
          ? "billing.connections.check"
          : "legal.consumer_context.read";
    await this.tokens.verifyActive(token, client, scope);
    if (kind === "billing" && !fresh(timestamp))
      throw new UnauthorizedException("Expired webhook timestamp");
    return true;
  }
}
type ResponseStatus = {
  status: (status: number) => unknown;
  setHeader: (key: string, value: string) => unknown;
};
function receipt(value: CheckoutAttemptResponse, response: ResponseStatus) {
  if (value.status === "pending" || value.status === "processing") {
    response.status(202);
    response.setHeader("Retry-After", String(value.retryAfterSeconds ?? 5));
  } else if (value.status === "rejected") response.status(422);
  return value;
}
@UseFilters(PaymentsExceptionFilter)
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}
  @Get("ready") @Header("Cache-Control", "no-store") ready() {
    return this.payments.ready();
  }
  @Get("plans") @Header("Cache-Control", "no-store") async plans(
    @Req() request: unknown,
  ) {
    return this.payments.listPlans(
      await this.payments.authorize(request, "plans.read"),
    );
  }
  @Get("subscription") @Header("Cache-Control", "no-store") async subscription(
    @Req() request: unknown,
  ) {
    return this.payments.getSubscription(
      await this.payments.authorize(request, "subscription.manage"),
    );
  }
  @Get("subscription/plan-change-quote")
  @Header("Cache-Control", "no-store")
  async planChangeQuote(@Req() request: unknown, @Query() input: unknown) {
    return this.payments.planChangeQuote(
      await this.payments.authorize(request, "subscription.manage"),
      planChangeQuoteInput(input),
    );
  }
  @Post("subscription/cancel")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async cancelSubscription(@Req() request: unknown, @Body() input: unknown) {
    return this.payments.cancelSubscription(
      await this.payments.authorize(request, "subscription.manage"),
      cancellationInput(input),
    );
  }
  @Post("subscription/change-plan")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async changePlan(
    @Req() request: unknown,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: ResponseStatus,
  ) {
    return receipt(
      await this.payments.createAttempt(
        await this.payments.authorize(request, "subscription.manage"),
        attemptInput(input),
        "change_plan",
      ),
      response,
    );
  }
  @Post("checkout-attempts")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async create(
    @Req() request: unknown,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: ResponseStatus,
  ) {
    const c = await this.payments.authorize(request, "checkout.manage");
    return receipt(
      await this.payments.createAttempt(c, attemptInput(input)),
      response,
    );
  }
  @Get("checkout-attempts/:id") @Header("Cache-Control", "no-store") async get(
    @Req() request: unknown,
    @Param("id") id: string,
  ) {
    return this.payments.getAttempt(
      await this.payments.authorizeAttempt(request, id),
      id,
    );
  }
  @Post("checkout-attempts/:id/confirm")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async confirm(@Req() request: unknown, @Param("id") id: string) {
    return this.payments.confirmAttempt(
      await this.payments.authorizeAttempt(request, id),
      id,
    );
  }
  @Post("checkout-attempts/:id/retry")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async retry(
    @Req() request: unknown,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: ResponseStatus,
  ) {
    return receipt(
      await this.payments.retryAttempt(
        await this.payments.authorizeAttempt(request, id),
        id,
      ),
      response,
    );
  }
  @Get("license") @Header("Cache-Control", "no-store") async license(
    @Req() request: unknown,
  ) {
    return this.payments.getLicense(
      await this.payments.authorize(request, "license.read"),
    );
  }
}
@UseFilters(PaymentsExceptionFilter)
@Controller("payments")
@SetMetadata(SERVICE_AUTHENTICATED_METADATA, true)
@UseGuards(PaymentsMachineGuard)
export class PaymentsMachineController {
  constructor(private readonly payments: PaymentsService) {}
  @Get("integration-status")
  @machine("console")
  @Header("Cache-Control", "no-store")
  check() {
    return this.payments.integrationStatus();
  }
  @Get("webhooks/license")
  @machine("billing")
  @Header("Cache-Control", "no-store")
  probe(@Query("productCode") product: string) {
    if (product !== this.payments.options.connection.productCode)
      throw new BadRequestException("Unsupported product");
    return {
      ready: true,
      contract: "billing.license.receiver",
      productCode: product,
    };
  }
  @Post("webhooks/license") @machine("billing") @HttpCode(200) receive(
    @Body() body: unknown,
  ) {
    return this.payments.receiveLicense(body);
  }
}
@UseFilters(PaymentsExceptionFilter)
@Controller("payments/legal")
export class PaymentsLegalController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly legal: PaymentsLegalService,
  ) {}
  @Post("prepare")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async prepare(@Req() request: unknown, @Body() input: unknown) {
    this.legal.enabled();
    return this.legal.prepare(
      await this.payments.authorize(request, "legal.accept"),
      prepareInput(input),
    );
  }
  @Post("accept")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async accept(@Req() request: unknown, @Body() input: unknown) {
    this.legal.enabled();
    return this.legal.accept(
      await this.payments.authorize(request, "legal.accept"),
      acceptInput(input),
    );
  }
  @Post("context")
  @HttpCode(200)
  @SetMetadata(SERVICE_AUTHENTICATED_METADATA, true)
  @machine("legal")
  @UseGuards(PaymentsMachineGuard)
  async context(@Body() input: unknown) {
    return this.legal.resolveContext(legalContextInput(input));
  }
}
