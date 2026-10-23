import {
  Injectable,
  Inject,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { endpoint } from "./validation";
import { PAYMENTS_OPTIONS, type PaymentsRuntimeOptions } from "./types";

export function validateServiceClaims(
  p: Record<string, unknown>,
  issuer: string,
  client: string,
  scope: string,
  audience: string,
  now = Math.floor(Date.now() / 1000),
) {
  return (
    p.iss === issuer &&
    p.aud === audience &&
    p.client_id === client &&
    p.sub === client &&
    p.grant_type === "client_credentials" &&
    !("email" in p) &&
    !("session_id" in p) &&
    typeof p.exp === "number" &&
    Number.isSafeInteger(p.exp) &&
    typeof p.iat === "number" &&
    Number.isSafeInteger(p.iat) &&
    p.iat <= now &&
    p.exp > now &&
    p.exp > p.iat &&
    p.exp - p.iat <= 600 &&
    (!("nbf" in p) ||
      (typeof p.nbf === "number" &&
        Number.isSafeInteger(p.nbf) &&
        p.nbf <= now)) &&
    typeof p.scope === "string" &&
    p.scope.split(/\s+/).includes(scope)
  );
}
type SigningKey = JsonWebKey & { kid?: string; alg?: string; use?: string };

@Injectable()
export class PaymentsServiceTokens {
  private keys?: { expires: number; keys: SigningKey[] };
  private loading?: Promise<void>;
  private lastRefreshAt = 0;
  constructor(
    @Inject(PAYMENTS_OPTIONS) private readonly options: PaymentsRuntimeOptions,
  ) {}

  isCurrent(claims: Record<string, unknown>, client: string, scope: string) {
    return validateServiceClaims(
      claims,
      this.options.connection.issuer,
      client,
      scope,
      this.options.receiver.audience,
    );
  }

  async verify(
    token: string,
    client: string,
    scope: string,
  ): Promise<Record<string, unknown>> {
    if (!this.options.connection.issuer || !this.options.receiver.jwksUrl)
      throw new ServiceUnavailableException(
        "Configure Identity issuer and JWKS for service callbacks",
      );
    try {
      if (
        token.length > 16384 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
      )
        throw new Error();
      const parts = token.split(".");
      const header: unknown = JSON.parse(
        Buffer.from(parts[0], "base64url").toString(),
      );
      const payload: unknown = JSON.parse(
        Buffer.from(parts[1], "base64url").toString(),
      );
      if (
        !header ||
        typeof header !== "object" ||
        Array.isArray(header) ||
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload)
      )
        throw new Error();
      const h = header as Record<string, unknown>,
        p = payload as Record<string, unknown>;
      if (
        h.alg !== "RS256" ||
        h.typ !== "at+jwt" ||
        typeof h.kid !== "string" ||
        !h.kid ||
        h.kid.length > 200 ||
        "crit" in h ||
        "b64" in h ||
        !this.isCurrent(p, client, scope)
      )
        throw new Error();
      if (!this.keys || this.keys.expires <= Date.now()) await this.loadKeys();
      let key = this.findKey(h.kid);
      if (!key && Date.now() - this.lastRefreshAt >= 30000) {
        await this.loadKeys();
        key = this.findKey(h.kid);
      }
      if (
        !key ||
        !verify(
          "RSA-SHA256",
          Buffer.from(parts[0] + "." + parts[1]),
          createPublicKey({ key, format: "jwk" }),
          Buffer.from(parts[2], "base64url"),
        ) ||
        !this.isCurrent(p, client, scope)
      )
        throw new Error();
      return p;
    } catch {
      throw new UnauthorizedException("Invalid service token");
    }
  }

  async verifyActive(token: string, client: string, scope: string) {
    const claims = await this.verify(token, client, scope);
    let value: Record<string, unknown>;
    try {
      const c = this.options.connection;
      const url = endpoint(
        this.options.receiver.introspectionUrl,
        c.allowHttpLoopback === true,
      );
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(c.tokenTimeoutMs ?? 5000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: c.clientId,
          client_secret: this.options.clientSecret,
          token,
        }),
      });
      const data: unknown = await response.json();
      if (
        !response.ok ||
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
      )
        throw new Error();
      value = data as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException(
        "Identity token introspection unavailable",
      );
    }
    if (
      value.active !== true ||
      value.aud !== this.options.receiver.audience ||
      value.client_id !== client ||
      typeof value.scope !== "string" ||
      !value.scope.split(/\s+/).includes(scope) ||
      typeof value.exp !== "number" ||
      !Number.isSafeInteger(value.exp) ||
      value.exp <= Date.now() / 1000 ||
      "sub" in value ||
      "session_id" in value ||
      "email" in value ||
      !this.isCurrent(claims, client, scope)
    )
      throw new UnauthorizedException("Inactive or invalid service token");
    return claims;
  }

  private findKey(kid: string) {
    return this.keys?.keys.find(
      (k) =>
        k &&
        k.kid === kid &&
        k.kty === "RSA" &&
        (!k.alg || k.alg === "RS256") &&
        (!k.use || k.use === "sig"),
    );
  }

  private loadKeys(): Promise<void> {
    if (this.loading) return this.loading;
    const load = async () => {
      const response = await fetch(
        endpoint(
          this.options.receiver.jwksUrl,
          this.options.connection.allowHttpLoopback === true,
        ),
        { redirect: "error", signal: AbortSignal.timeout(3000) },
      );
      const data: unknown = await response.json();
      if (
        !response.ok ||
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        !Array.isArray((data as { keys?: unknown }).keys)
      )
        throw new Error();
      const keys = (data as { keys: SigningKey[] }).keys;
      if (keys.length > 100) throw new Error();
      this.keys = { expires: Date.now() + 60000, keys };
      this.lastRefreshAt = Date.now();
    };
    this.loading = load().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }
}
