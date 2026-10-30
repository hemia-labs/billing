import { MachineClient, MachineClientError } from "@hemia/auth";
import type { PaymentsConnection } from "./index";
import { PaymentsError } from "./errors";
import { endpoint, exact, record, text } from "./validation";

export type PaymentsConnectionOptions = {
  baseUrl: string;
  connectionCode: string;
  clientId: string;
  clientSecret: string;
  /** Development only. Production always requires HTTPS. */
  allowHttpLoopback?: boolean;
  tokenTimeoutMs?: number;
  requestTimeoutMs?: number;
};
const discoveryPath = "/api/v1/billing/integrations/v1/connections/discovery";
const configurationPath =
  "/api/v1/billing/integrations/v1/connections/{connectionCode}";
const scope = "billing.integration.catalog.read";
const identifier = (value: unknown, max = 120): value is string =>
  text(value, max) && !/\s/.test(value);
const timeout = (value: number | undefined) => {
  const result = value ?? 5000;
  if (!Number.isInteger(result) || result < 1 || result > 30000)
    throw new PaymentsError("configuration", 400);
  return result;
};

async function json(response: Response, limit: number): Promise<unknown> {
  if (!response.ok)
    throw new PaymentsError(
      [401, 403].includes(response.status) ? "authentication" : "http",
      response.status,
    );
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new PaymentsError("contract", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new PaymentsError("contract", 502);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof PaymentsError) throw error;
    throw new PaymentsError("contract", 502);
  } finally {
    reader.releaseLock();
  }
}

function connection(
  value: unknown,
  options: PaymentsConnectionOptions,
  metadata: Record<string, unknown>,
  local: boolean,
): PaymentsConnection {
  try {
    exact(value, [
      "issuer",
      "tokenUrl",
      "clientId",
      "baseUrl",
      "resource",
      "audience",
      "productCode",
      "receiver",
      "legal",
      "successUrl",
      "cancelUrl",
      "allowHttpLoopback",
      "tokenTimeoutMs",
      "requestTimeoutMs",
    ]);
    if (
      value.clientId !== options.clientId ||
      !identifier(value.productCode, 80) ||
      value.audience !== metadata.audience ||
      typeof value.issuer !== "string" ||
      typeof value.tokenUrl !== "string" ||
      typeof value.baseUrl !== "string" ||
      typeof value.resource !== "string" ||
      endpoint(value.issuer, local).href !==
        endpoint(String(metadata.issuer), local).href ||
      endpoint(value.tokenUrl, local).href !==
        endpoint(String(metadata.tokenUrl), local).href ||
      endpoint(value.baseUrl, local).origin !==
        endpoint(options.baseUrl, local).origin ||
      endpoint(value.resource, local).href !==
        endpoint(String(metadata.resource), local).href ||
      (value.allowHttpLoopback !== undefined &&
        (typeof value.allowHttpLoopback !== "boolean" ||
          (value.allowHttpLoopback && !local)))
    )
      throw new Error();
    for (const field of ["successUrl", "cancelUrl"] as const) {
      if (value[field] !== undefined) {
        if (typeof value[field] !== "string") throw new Error();
        // Return URLs may carry a durable payment attempt identifier.
        const u = new URL(value[field]);
        u.search = "";
        endpoint(u.href, local);
      }
    }
    for (const field of ["tokenTimeoutMs", "requestTimeoutMs"] as const)
      if (value[field] !== undefined) {
        if (typeof value[field] !== "number") throw new Error();
        timeout(value[field]);
      }
    if (value.receiver !== undefined) {
      exact(value.receiver, ["audience", "billingClientId", "consoleClientId"]);
      if (!identifier(value.receiver.audience)) throw new Error();
      for (const key of ["billingClientId", "consoleClientId"])
        if (
          value.receiver[key] !== undefined &&
          !identifier(value.receiver[key])
        )
          throw new Error();
    }
    if (value.legal !== undefined) {
      exact(value.legal, [
        "baseUrl",
        "resource",
        "audience",
        "verificationClientId",
      ]);
      if (
        !identifier(value.legal.audience) ||
        !identifier(value.legal.verificationClientId) ||
        typeof value.legal.baseUrl !== "string" ||
        typeof value.legal.resource !== "string" ||
        endpoint(value.legal.baseUrl, local).origin !==
          endpoint(value.legal.resource, local).origin
      )
        throw new Error();
    }
    return value as PaymentsConnection;
  } catch {
    throw new PaymentsError("contract", 502);
  }
}

/** Resolve once during backend initialization; normal operations keep the resolved configuration. */
export async function resolvePaymentsConnection(
  options: PaymentsConnectionOptions,
): Promise<PaymentsConnection> {
  let base: URL;
  let requestTimeout: number;
  let tokenTimeout: number;
  const local =
    options?.allowHttpLoopback === true &&
    process.env.NODE_ENV !== "production";
  try {
    if (
      typeof window !== "undefined" ||
      !options ||
      typeof options.connectionCode !== "string" ||
      !/^[a-z][a-z0-9_-]{1,79}$/.test(options.connectionCode) ||
      options.connectionCode === "discovery" ||
      !identifier(options.clientId) ||
      !text(options.clientSecret, 255)
    )
      throw new Error();
    base = endpoint(options.baseUrl, local);
    if (base.pathname !== "/") throw new Error();
    requestTimeout = timeout(options.requestTimeoutMs);
    tokenTimeout = timeout(options.tokenTimeoutMs);
  } catch {
    throw new PaymentsError("configuration", 400);
  }
  let metadata: unknown;
  try {
    metadata = await json(
      await fetch(new URL(discoveryPath, base), {
        headers: { Accept: "application/json" },
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(requestTimeout),
      }),
      16384,
    );
  } catch (error) {
    if (error instanceof PaymentsError) throw error;
    throw new PaymentsError("transport", 502);
  }
  let machine: MachineClient;
  try {
    exact(metadata, [
      "contract",
      "issuer",
      "tokenUrl",
      "audience",
      "resource",
      "scope",
      "configurationPath",
    ]);
    if (
      metadata.contract !== "hemia.payments.connections.v1" ||
      metadata.scope !== scope ||
      metadata.configurationPath !== configurationPath ||
      !identifier(metadata.audience) ||
      typeof metadata.issuer !== "string" ||
      typeof metadata.tokenUrl !== "string" ||
      typeof metadata.resource !== "string" ||
      endpoint(metadata.resource, local).origin !== base.origin
    )
      throw new Error();
    machine = new MachineClient({
      issuer: metadata.issuer,
      tokenUrl: metadata.tokenUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      allowHttpLoopback: local,
      tokenTimeoutMs: tokenTimeout,
      requestTimeoutMs: requestTimeout,
      destinations: {
        configuration: {
          baseUrl: base.origin,
          audience: metadata.audience,
          resource: metadata.resource,
          scopes: [scope],
        },
      },
    });
  } catch {
    throw new PaymentsError("contract", 502);
  }
  try {
    const result = await json(
      await machine.request(
        "configuration",
        configurationPath.replace(
          "{connectionCode}",
          encodeURIComponent(options.connectionCode),
        ),
        {
          headers: { Accept: "application/json" },
        },
      ),
      65536,
    );
    if (
      !record(result) ||
      result.contract !== "hemia.payments.connection.v1" ||
      result.connectionCode !== options.connectionCode ||
      result.version !== 1
    )
      throw new PaymentsError("contract", 502);
    return connection(result.configuration, options, metadata, local);
  } catch (error) {
    if (error instanceof PaymentsError) throw error;
    if (error instanceof MachineClientError)
      throw new PaymentsError(
        error.stage === "token" ? "authentication" : "transport",
        error.status ?? 502,
      );
    throw new PaymentsError("transport", 502);
  }
}
