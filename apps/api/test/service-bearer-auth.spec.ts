import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, KeyObject, sign } from 'crypto';
import { BillingInternalAuthGuard } from '../src/common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { SsoBearerGuard } from '../src/common/guards/sso-bearer.guard';
import { AuthenticatedPrincipal } from '../src/common/types/authenticated-request.type';
import { BillingServicePolicyService } from '../src/common/services/billing-service-policy.service';

const issuer = 'https://identity.test';
const audience = 'billing-api';
const scope = 'billing.integration.checkout.create';
const now = Math.floor(Date.now() / 1000);
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const untrustedKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  key: KeyObject = keys.privateKey,
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = [
    encode({ alg: 'RS256', typ: 'at+jwt', kid: 'identity-key', ...header }),
    encode({
      iss: issuer,
      aud: audience,
      sub: 'medsync-service',
      client_id: 'medsync-service',
      grant_type: 'client_credentials',
      iat: now,
      exp: now + 300,
      scope,
      ...claims,
    }),
  ].join('.');
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

describe('Integration bearer authentication with signed service claims', () => {
  let fetcher: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            {
              ...keys.publicKey.export({ format: 'jwk' }),
              kid: 'identity-key',
            },
          ],
        }),
      ),
    );
  });

  afterEach(() => {
    fetcher.mockRestore();
  });

  async function authorize(
    bearer: string,
    config: Record<string, unknown> = {},
  ) {
    const request = {
      header: jest.fn((name: string) =>
        name === 'authorization' ? `Bearer ${bearer}` : undefined,
      ),
      principal: undefined as AuthenticatedPrincipal | undefined,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => null,
      getClass: () => null,
    } as unknown as ExecutionContext;
    const settings = new ConfigService({
      auth: {
        requiredIssuer: issuer,
        audience,
        jwksUri: `${issuer}/.well-known/jwks.json`,
        serviceClients: {
          'medsync-service': {
            enabled: true,
            products: ['medsync'],
            organizationScope: 'all_for_allowed_products',
            allowSharedCheckouts: false,
          },
        },
        ...config,
      },
    });
    const authentication = new BillingInternalAuthGuard(
      new SsoBearerGuard(settings),
      new BillingServicePolicyService(settings),
    );
    const permissions = new PermissionsGuard(
      { getAllAndOverride: () => [scope] } as never,
      {} as never,
      { canActivate: jest.fn().mockResolvedValue(true) } as never,
    );
    await authentication.canActivate(context);
    await permissions.canActivate(context);
    return request;
  }

  it('accepts a service without SSO cookies or a user session', async () => {
    const request = await authorize(token());
    expect(request.principal).toMatchObject({
      sub: 'medsync-service',
      clientId: 'medsync-service',
      issuer,
      isMachine: true,
      scopes: [scope],
    });
    expect(request.header.mock.calls).toEqual([
      ['authorization'],
      ['authorization'],
    ]);
  });

  it('classifies the service independently of its email', async () => {
    await expect(
      authorize(token({ email: 'service@hemia.test' })),
    ).resolves.toMatchObject({ principal: { isMachine: true } });
  });

  it('rejects an unregistered client even with a valid signed token and scope', async () => {
    await expect(
      authorize(token({ client_id: 'other-service' })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a registered disabled client', async () => {
    await expect(
      authorize(token(), {
        serviceClients: { 'medsync-service': { enabled: false } },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('preserves scope arrays from the existing contract', async () => {
    await expect(
      authorize(token({ scope: undefined, scopes: [scope] })),
    ).resolves.toMatchObject({ principal: { scopes: [scope] } });
  });

  it.each([
    ['user token without email', { grant_type: 'authorization_code' }],
    [
      'user token with email',
      { grant_type: 'authorization_code', email: 'user@hemia.test' },
    ],
    ['missing grant even with client_id', { grant_type: undefined }],
    ['unknown grant', { grant_type: 'other' }],
    ['missing client_id', { client_id: undefined }],
    ['empty client_id', { client_id: ' ' }],
    ['non-string client_id', { client_id: 123 }],
    [
      'clientId alias without client_id',
      { client_id: undefined, clientId: 'medsync-service' },
    ],
    [
      'azp alias without client_id',
      { client_id: undefined, azp: 'medsync-service' },
    ],
    ['missing subject', { sub: undefined }],
    ['empty subject', { sub: ' ' }],
    ['missing expiration', { exp: undefined }],
    ['non-numeric expiration', { exp: `${now + 300}` }],
    ['expired token', { exp: now - 1, iat: now - 300 }],
    ['missing issued-at', { iat: undefined }],
    ['non-numeric issued-at', { iat: `${now}` }],
    ['future issued-at', { iat: now + 120 }],
    ['service lifetime longer than 10 minutes', { exp: now + 601 }],
    ['expiration before issued-at', { iat: now + 10, exp: now + 5 }],
    ['wrong issuer', { iss: 'https://untrusted.test' }],
    ['missing issuer', { iss: undefined }],
    ['wrong audience', { aud: 'other-api' }],
    ['missing audience', { aud: undefined }],
    ['token not yet valid', { nbf: now + 300 }],
  ])('rejects %s with 401', async (_name, claims) => {
    await expect(authorize(token(claims))).rejects.toMatchObject({
      status: 401,
    });
  });

  it.each([
    ['missing scope', { scope: undefined }],
    ['unrelated scope', { scope: 'billing.integration.catalog.read' }],
  ])('rejects a valid service with %s with 403', async (_name, claims) => {
    await expect(authorize(token(claims))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects an untrusted signature', async () => {
    await expect(
      authorize(token({}, {}, untrustedKeys.privateKey)),
    ).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    ['unexpected algorithm', { alg: 'HS256' }],
    ['missing key id', { kid: undefined }],
    ['unknown key id', { kid: 'unknown' }],
  ])('rejects %s', async (_name, header) => {
    await expect(authorize(token({}, header))).rejects.toMatchObject({
      status: 401,
    });
  });

  it.each(['audience', 'requiredIssuer'])(
    'requires configured %s',
    async (key) => {
      await expect(
        authorize(token(), { [key]: undefined }),
      ).rejects.toMatchObject({ status: 401 });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('rejects opaque and malformed credentials without consulting JWKS', async () => {
    await expect(authorize('opaque-access-token')).rejects.toMatchObject({
      status: 401,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
