import {
  createPaymentsClient,
  parsePaymentSnapshot,
  type PaymentsConfig,
} from "./index";
import { PaymentsError } from "./errors";
import { ServiceTokens } from "./service-tokens";
import { webhookInput } from "./validation";
import type { PaymentsReceiverOptions, SnapshotSink } from "./contracts";
export type ReceiverHeaders = { authorization?: string; timestamp?: string };
export function createPaymentsReceiver(
  config: PaymentsConfig,
  options: {
    receiver?: PaymentsReceiverOptions;
    onSnapshot?: SnapshotSink;
  } = {},
) {
  const r = options.receiver ?? config.receiver;
  const tokenUrl = new URL(config.tokenUrl);
  tokenUrl.pathname = tokenUrl.pathname.replace(/\/token$/, "/introspect");
  const receiver = {
    audience: r?.audience ?? "",
    billingClientId: r?.billingClientId ?? "",
    consoleClientId: r?.consoleClientId ?? "",
    jwksUrl:
      options.receiver?.jwksUrl ??
      new URL("/.well-known/jwks.json", config.issuer).href,
    introspectionUrl: options.receiver?.introspectionUrl ?? tokenUrl.href,
  };
  const tokens = new ServiceTokens({
    connection: config,
    clientSecret: config.clientSecret,
    receiver,
  });
  async function verify(
    headers: ReceiverHeaders,
    client: string | undefined,
    scope: string,
    timestamp = false,
  ) {
    if (!client || !receiver.audience)
      throw new PaymentsError("configuration", 503);
    const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(
      headers.authorization ?? "",
    )?.[1];
    const fresh = () =>
      /^\d{10}$/.test(headers.timestamp ?? "") &&
      Math.abs(Date.now() / 1000 - Number(headers.timestamp)) <= 300;
    if (!bearer || (timestamp && !fresh()))
      throw new PaymentsError("authentication", 401);
    await tokens.verifyActive(bearer, client, scope);
    if (timestamp && !fresh()) throw new PaymentsError("authentication", 401);
  }
  async function apply(snapshot: ReturnType<typeof parsePaymentSnapshot>) {
    if (!options.onSnapshot) throw new PaymentsError("configuration", 404);
    const result = await options.onSnapshot(snapshot);
    if (!result || typeof result.applied !== "boolean")
      throw new PaymentsError("contract");
    return { received: true as const, applied: result.applied };
  }
  return {
    async receive(headers: ReceiverHeaders, body: unknown) {
      if (!options.onSnapshot) throw new PaymentsError("configuration", 404);
      await verify(
        headers,
        receiver.billingClientId,
        "billing.webhooks.deliver",
        true,
      );
      webhookInput(body, config.productCode);
      return apply(parsePaymentSnapshot(body, config.productCode));
    },
    async probe(headers: ReceiverHeaders, productCode: string) {
      if (!options.onSnapshot) throw new PaymentsError("configuration", 404);
      await verify(
        headers,
        receiver.billingClientId,
        "billing.webhooks.deliver",
        true,
      );
      if (productCode !== config.productCode)
        throw new PaymentsError("configuration", 400);
      return {
        ready: true as const,
        contract: "billing.license.receiver",
        productCode,
      };
    },
    async verifyConsole(headers: ReceiverHeaders) {
      await verify(
        headers,
        receiver.consoleClientId,
        "billing.connections.check",
      );
    },
    async verifyLegal(headers: ReceiverHeaders) {
      await verify(
        headers,
        config.legal?.verificationClientId,
        "legal.consumer_context.read",
      );
    },
    async synchronize(organizationId: string) {
      const snapshot =
        await createPaymentsClient(config).snapshots.current(organizationId);
      return { snapshot, ...(options.onSnapshot ? await apply(snapshot) : {}) };
    },
  };
}
