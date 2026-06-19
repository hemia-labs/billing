import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonWebKey as NodeJsonWebKey, createPublicKey } from 'crypto';
import { JwtPayload, decode, verify } from 'jsonwebtoken';
import {
  AuthenticatedPrincipal,
  AuthenticatedRequest,
} from '../types/authenticated-request.type';

type SsoJwtPayload = JwtPayload & {
  scope?: unknown;
  scopes?: unknown;
  client_id?: unknown;
  clientId?: unknown;
  azp?: unknown;
  organizationId?: unknown;
  organization_id?: unknown;
  email?: unknown;
  grant_type?: unknown;
};

type JwksResponse = {
  keys?: JwkWithKid[];
};

type JwkWithKid = NodeJsonWebKey & {
  kid?: string;
};

@Injectable()
export class SsoBearerGuard implements CanActivate {
  private publicKeys = new Map<string, string>();

  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);
    const payload = await this.verifyToken(token);
    const principal = this.toPrincipal(payload);

    request.principal = principal;
    request.user = principal;

    return true;
  }

  private extractBearerToken(request: AuthenticatedRequest): string {
    const authorization = request.header('authorization');

    if (!authorization) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token?.trim()) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    return token;
  }

  private async verifyToken(token: string): Promise<SsoJwtPayload> {
    const decoded = decode(token, { complete: true });
    const kid = decoded?.header.kid;

    if (!decoded || decoded.header.alg !== 'RS256' || !kid) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    const publicKey = await this.getPublicKey(kid);

    try {
      return verify(token, publicKey, {
        algorithms: ['RS256'],
        audience: this.config.get<string>('auth.audience'),
        issuer:
          this.config.get<string>('auth.requiredIssuer') ??
          this.config.get<string>('auth.issuerUrl'),
      }) as SsoJwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }
  }

  private async getPublicKey(kid: string): Promise<string> {
    const cachedKey = this.publicKeys.get(kid);

    if (cachedKey) {
      return cachedKey;
    }

    const jwksUri = this.config.get<string>('auth.jwksUri');

    if (!jwksUri) {
      throw new UnauthorizedException('SSO auth is not configured');
    }

    try {
      const response = await fetch(jwksUri);
      const jwks = (await response.json()) as JwksResponse;
      const key = jwks.keys?.find((jwk) => jwk.kid === kid);

      if (!response.ok || !key) {
        throw new Error('JWKS key not found');
      }

      const publicKey = createPublicKey({ key, format: 'jwk' }).export({
        format: 'pem',
        type: 'spki',
      }) as string;

      this.publicKeys.set(kid, publicKey);

      return publicKey;
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }
  }

  private toPrincipal(payload: SsoJwtPayload): AuthenticatedPrincipal {
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    const scopes = this.normalizeScopes(payload);
    const clientId = this.firstString(
      payload.client_id,
      payload.clientId,
      payload.azp,
    );
    const email = this.firstString(payload.email);

    return {
      sub: payload.sub,
      clientId,
      email,
      scopes,
      organizationId: this.firstString(
        payload.organizationId,
        payload.organization_id,
      ),
      isMachine:
        payload.grant_type === 'client_credentials' ||
        Boolean(clientId && !email),
    };
  }

  private normalizeScopes(payload: SsoJwtPayload): string[] {
    if (typeof payload.scope === 'string') {
      return payload.scope
        .split(' ')
        .map((scope) => scope.trim())
        .filter(Boolean);
    }

    if (
      Array.isArray(payload.scopes) &&
      payload.scopes.every((scope) => typeof scope === 'string')
    ) {
      return payload.scopes;
    }

    return [];
  }

  private firstString(...values: unknown[]): string | undefined {
    return values.find(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    );
  }
}
