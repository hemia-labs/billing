import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MachineClient } from "@hemia/auth";
import {
  PAYMENTS_OPTIONS,
  type AcceptLegalInput,
  type LegalContextInput,
  type PaymentsContext,
  type PaymentsRuntimeOptions,
  type PreparedLegal,
} from "./types";
import {
  acceptInput,
  context,
  endpoint,
  record,
  text,
  uuid,
} from "./validation";
@Injectable()
export class PaymentsLegalService {
  private machine?: MachineClient;
  constructor(
    @Inject(PAYMENTS_OPTIONS) private readonly options: PaymentsRuntimeOptions,
  ) {}
  enabled() {
    if (!this.options.legal)
      throw new NotFoundException("Legal integration is disabled");
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
      throw new BadGatewayException("Legal integration unavailable");
    }
    if (response.status === 409)
      throw new ConflictException("LEGAL_REQUEST_EXPIRED_OR_CHANGED");
    if (response.status === 403)
      throw new ForbiddenException("Legal denied acceptance");
    if (!response.ok)
      throw new BadGatewayException("Legal integration unavailable");
    const value: unknown = await response.json().catch(() => null);
    if (!record(value)) throw new BadGatewayException("Invalid Legal response");
    return value;
  }
  async prepare(c: PaymentsContext, key: string): Promise<PreparedLegal> {
    context(c);
    if (!c.sessionId) throw new ForbiddenException("Verified session required");
    if (!uuid(key))
      throw new ConflictException("Invalid Legal idempotency key");
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
      throw new BadGatewayException("Invalid Legal documents");
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
      throw new BadGatewayException("Invalid Legal documents");
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
    if (!c.sessionId) throw new ForbiddenException("Verified session required");
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
      throw new BadGatewayException("Invalid Legal acceptance");
    return {
      requestId: dto.requestId,
      legalAcceptanceId: b.legalAcceptanceId,
      identitySourceId: b.identitySourceId,
      productCode: this.options.connection.productCode,
      accepted: true,
    };
  }
  async resolveContext(input: LegalContextInput) {
    const result = await this.enabled().resolveContext(input);
    if (
      !result ||
      result.subjectId !== input.subjectId ||
      result.organizationId !== input.organizationId ||
      !uuid(result.membershipId) ||
      typeof result.canContract !== "boolean" ||
      !Array.isArray(result.roles) ||
      result.roles.some((r) => !text(r, 200))
    )
      throw new BadGatewayException("Invalid application authorization result");
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
