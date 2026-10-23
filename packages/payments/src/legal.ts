import { PaymentsError } from "./errors";
import type { PaymentsConfig, PaymentsConnection } from "./index";
import type { PaymentsLegalOptions, PaymentsLegalInput } from "./contracts";
export type LegalClientOptions = {
  connection: PaymentsConnection;
  clientSecret: string;
  legal?: PaymentsLegalOptions;
};
export function createPaymentsLegalClient(
  config: PaymentsConfig,
  legal?: PaymentsLegalInput,
) {
  const merged =
    config.legal || legal ? { ...config.legal, ...legal } : undefined;
  if (
    merged &&
    (!merged.baseUrl ||
      !merged.audience ||
      !merged.resource ||
      !merged.verificationClientId)
  )
    throw new PaymentsError("configuration", 400);
  if (merged) {
    endpoint(merged.baseUrl!, config.allowHttpLoopback === true);
    endpoint(merged.resource!, config.allowHttpLoopback === true);
  }
  return new PaymentsLegalClient({
    connection: config,
    clientSecret: config.clientSecret,
    legal: merged as PaymentsLegalOptions | undefined,
  });
}
import { MachineClient } from "@hemia/auth";
import {
  type AcceptLegalInput,
  type LegalContextInput,
  type PaymentsContext,
  type PreparedLegal,
} from "./contracts";
import {
  acceptInput,
  legalContextInput,
  context,
  endpoint,
  record,
  text,
  uuid,
} from "./validation";
export class PaymentsLegalClient {
  private machine?: MachineClient;
  constructor(private readonly options: LegalClientOptions) {}
  enabled() {
    if (!this.options.legal) throw new PaymentsError("configuration", 404);
    return this.options.legal;
  }
  private async call(path: string, payload: unknown) {
    const l = this.enabled();
    const c = this.options.connection;
    let response: Response;
    try {
      if (!this.machine)
        this.machine = new MachineClient({
          issuer: c.issuer,
          tokenUrl: c.tokenUrl,
          clientId: c.clientId,
          clientSecret: this.options.clientSecret,
          allowHttpLoopback: c.allowHttpLoopback,
          tokenTimeoutMs: c.tokenTimeoutMs,
          requestTimeoutMs: c.requestTimeoutMs ?? 10000,
          destinations: {
            legal: {
              baseUrl: l.baseUrl,
              audience: l.audience,
              resource: l.resource,
              scopes: [
                "legal.integration.acceptances.prepare",
                "legal.integration.acceptances.create",
              ],
            },
          },
        });
      response = await this.machine.request(
        "legal",
        "v1/legal/integrations/" + path,
        {
          method: "POST",
          scopes: [
            path === "acceptance-requests"
              ? "legal.integration.acceptances.prepare"
              : "legal.integration.acceptances.create",
          ],
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
    } catch {
      throw new PaymentsError("transport", 502);
    }
    if (response.status === 409) throw new PaymentsError("http", 409);
    if (response.status === 403) throw new PaymentsError("authentication", 403);
    if (!response.ok) throw new PaymentsError("transport", 502);
    const value: unknown = await response.json().catch(() => null);
    if (!record(value)) throw new PaymentsError("transport", 502);
    return value;
  }
  async prepare(c: PaymentsContext, key: string): Promise<PreparedLegal> {
    context(c);
    if (!c.sessionId) throw new PaymentsError("authentication", 403);
    if (!uuid(key)) throw new PaymentsError("http", 409);
    const body = await this.call("acceptance-requests", {
      subjectId: c.subjectId,
      organizationId: c.organizationId,
      sessionId: c.sessionId,
      idempotencyKey: key,
    });
    if (
      !uuid(body.requestId) ||
      !uuid(body.identitySourceId) ||
      body.productCode !== this.options.connection.productCode ||
      typeof body.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(body.expiresAt)) ||
      !Array.isArray(body.documents) ||
      !body.documents.length ||
      body.documents.length > 100
    )
      throw new PaymentsError("transport", 502);
    const docs = body.documents as PreparedLegal["documents"];
    if (
      docs.some((d) => !record(d)) ||
      new Set(docs.map((d) => d.documentId)).size !== docs.length ||
      new Set(docs.map((d) => d.documentVersionId)).size !== docs.length ||
      docs.some(
        (d) =>
          !uuid(d.documentId) ||
          !uuid(d.documentVersionId) ||
          typeof d.contentHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(d.contentHash) ||
          !text(d.title, 500) ||
          !text(d.version, 100) ||
          !text(d.kind, 40) ||
          !record(d.artifacts) ||
          !Object.values(d.artifacts).some((a) => this.safeArtifact(a?.url)),
      )
    )
      throw new PaymentsError("transport", 502);
    return {
      requestId: body.requestId,
      identitySourceId: body.identitySourceId,
      productCode: this.options.connection.productCode,
      expiresAt: body.expiresAt,
      documents: docs.map((d) => ({
        documentId: d.documentId,
        documentVersionId: d.documentVersionId,
        contentHash: d.contentHash,
        title: d.title,
        version: d.version,
        kind: d.kind,
        artifacts: Object.fromEntries(
          Object.entries(d.artifacts)
            .filter(([, a]) => this.safeArtifact(a?.url))
            .map(([k, a]) => [k, { url: a.url }]),
        ),
      })),
    };
  }
  async accept(c: PaymentsContext, input: AcceptLegalInput) {
    context(c);
    if (!c.sessionId) throw new PaymentsError("authentication", 403);
    const dto = acceptInput(input);
    const b = await this.call("acceptances", {
      ...dto,
      subjectId: c.subjectId,
      organizationId: c.organizationId,
      sessionId: c.sessionId,
    });
    if (
      b.requestId !== dto.requestId ||
      !uuid(b.legalAcceptanceId) ||
      !uuid(b.identitySourceId) ||
      b.productCode !== this.options.connection.productCode ||
      b.accepted !== true
    )
      throw new PaymentsError("transport", 502);
    return {
      requestId: dto.requestId,
      legalAcceptanceId: b.legalAcceptanceId,
      identitySourceId: b.identitySourceId,
      productCode: this.options.connection.productCode,
      accepted: true,
    };
  }
  async resolveContext(input: LegalContextInput) {
    legalContextInput(input);
    const resolve = this.enabled().resolveContext;
    if (!resolve) throw new PaymentsError("configuration", 404);
    const result = await resolve(input);
    if (
      !result ||
      result.subjectId !== input.subjectId ||
      result.organizationId !== input.organizationId ||
      !uuid(result.membershipId) ||
      typeof result.canContract !== "boolean" ||
      !Array.isArray(result.roles) ||
      result.roles.some((r) => !text(r, 200))
    )
      throw new PaymentsError("transport", 502);
    return {
      subjectId: result.subjectId,
      organizationId: result.organizationId,
      membershipId: result.membershipId,
      roles: result.roles,
      canContract: result.canContract,
    };
  }
  private safeArtifact(v: unknown) {
    try {
      if (typeof v !== "string") return false;
      const u = new URL(v);
      endpoint(
        v.split("?")[0],
        this.options.connection.allowHttpLoopback === true,
      );
      return !u.username && !u.password && !u.hash;
    } catch {
      return false;
    }
  }
}
