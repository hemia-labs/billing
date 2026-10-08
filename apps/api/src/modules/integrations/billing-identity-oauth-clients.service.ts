import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type IdentityOAuthClient = {
  clientId: string;
  audience: string;
  grantTypes: string[];
  scopes: string[];
};

const CLIENTS_SCOPE = 'identity.oauth_clients.read';
const TOKEN_REFRESH_MARGIN_MS = 30_000;

@Injectable()
export class BillingIdentityOAuthClientsService {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  async listServiceClients(): Promise<IdentityOAuthClient[]> {
    const tokenUrl = this.endpoint(
      this.config.getOrThrow<string>('sso.tokenUrl'),
    );
    const url = new URL('/api/v1/oauth-clients', tokenUrl);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${await this.getAccessToken()}` },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 401 || response.status === 403)
        throw new ServiceUnavailableException(
          'Identity denied OAuth client catalog access; verify identity.oauth_clients.read for Billing',
        );
      if (!response.ok) throw new Error();
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error();
      const ownClientId = this.config.getOrThrow<string>('sso.clientId');
      return body
        .filter((client) => isServiceClient(client, ownClientId))
        .map(({ clientId, audience, scopes, grantTypes }) => ({
          clientId,
          audience,
          grantTypes,
          scopes,
        }));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Identity OAuth client catalog is unavailable',
      );
    }
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.accessToken &&
      Date.now() < this.accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS
    )
      return this.accessToken;

    const tokenUrl = this.endpoint(
      this.config.getOrThrow<string>('sso.tokenUrl'),
    );
    const resource = tokenUrl.origin;
    const clientId = this.config.getOrThrow<string>('sso.clientId');
    const clientSecret = this.config.get<string>('sso.clientSecret');
    if (!clientSecret)
      throw new ServiceUnavailableException(
        'Identity service credentials are not configured',
      );

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          resource,
          scope: CLIENTS_SCOPE,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 401 || response.status === 403)
        throw new ServiceUnavailableException(
          'Identity rejected Billing service credentials or destination scope',
        );
      if (!response.ok) throw new Error();
      const body: unknown = await response.json();
      if (
        !isRecord(body) ||
        typeof body.access_token !== 'string' ||
        !body.access_token ||
        body.token_type !== 'Bearer' ||
        typeof body.expires_in !== 'number' ||
        body.expires_in <= 0
      )
        throw new Error();
      this.accessToken = body.access_token;
      this.accessTokenExpiresAt = Date.now() + body.expires_in * 1000;
      return this.accessToken;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Identity service credentials were rejected',
      );
    }
  }

  private endpoint(value: string): URL {
    const url = new URL(value);
    const localHttp =
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      this.config.get<string>('app.nodeEnv') !== 'production';
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' && !localHttp)
    )
      throw new ServiceUnavailableException(
        'Identity endpoint is not configured securely',
      );
    return url;
  }
}

function isServiceClient(
  value: unknown,
  ownClientId: string,
): value is IdentityOAuthClient {
  return (
    isRecord(value) &&
    typeof value.clientId === 'string' &&
    value.clientId.length > 0 &&
    typeof value.audience === 'string' &&
    value.status === 'active' &&
    value.type === 'confidential' &&
    Array.isArray(value.grantTypes) &&
    value.grantTypes.includes('client_credentials') &&
    value.clientId !== ownClientId &&
    Array.isArray(value.scopes) &&
    value.grantTypes.every((grant) => typeof grant === 'string') &&
    value.scopes.every((scope) => typeof scope === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
