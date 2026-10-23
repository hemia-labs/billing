import { BillingOrganizationController } from '../../../../apps/api/src/modules/auth/session/billing-organization.controller';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  UnauthorizedError,
  AccessContextError,
  type AccessOrganizationContext,
} from '@hemia/auth';
import ssoConfig, {
  buildSsoConfig,
} from '../../../../apps/api/src/config/sso.config';
import { BillingConsoleSessionService } from '../../../../apps/api/src/modules/auth/session/billing-console-session.service';
import { AuthSessionMiddleware } from '../../../../apps/api/src/modules/auth/session/auth-session.middleware';
import type { AuthenticatedRequest } from '../../../../apps/api/src/common/types/authenticated-request.type';

const accessOrganization = (
  input: Partial<AccessOrganizationContext> = {},
): AccessOrganizationContext => ({
  organization_id: '8b2f71b1-56f5-4826-a587-84cbe26da3eb',
  organization_code: 'acme',
  organization_name: 'ACME',
  organization_status: 'active',
  membership_id: '22222222-1111-4111-8111-111111111111',
  membership_status: 'active',
  context_version: 1,
  roles: ['organization_admin'],
  permissions: [
    'billing.access',
    'billing.console.access',
    'billing.catalog.read',
  ],
  product: { code: 'billing', status: 'enabled' },
  ...input,
});

const requestFixture = (
  organization: AccessOrganizationContext | AccessOrganizationContext[],
): AuthenticatedRequest =>
  ({
    method: 'GET',
    user: { sub: 'user-id', email: 'user@example.com', name: 'User' },
    accessContext: {
      identity: {
        issuer: 'issuer',
        subject_id: 'user-id',
        type: 'user',
        identity_reference_id: '33333333-1111-4111-8111-111111111111',
      },
      organizations: Array.isArray(organization)
        ? organization
        : [organization],
    },
    ssoAuth: {
      accessToken: 'identity-token',
      cookie: 'session-id',
      authorization: 'Bearer identity-token',
    },
  }) as AuthenticatedRequest;

function serviceFixture() {
  const accessClient = {
    exchangeUserToken: jest.fn().mockResolvedValue('access-token'),
    resolveSystemContext: jest.fn().mockResolvedValue({
      iss: 'https://access.test',
      aud: 'billing-api',
      sub: 'user-id',
      identity_issuer: 'issuer',
      organization_id: accessOrganization().organization_id,
      membership_id: '22222222-1111-4111-8111-111111111111',
      identity_reference_id: '33333333-1111-4111-8111-111111111111',
      product_code: 'billing',
      contract_version: 1,
      catalog_version: 1,
      context_version: 1,
      jti: '44444444-1111-4111-8111-111111111111',
      iat: Math.floor(Date.now() / 1000),
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      assignments: [
        {
          assignment_id: '55555555-1111-4111-8111-111111111111',
          assignment_version: 1,
          role_code: 'billing.catalog_manager',
          scope: { type: 'catalog_global' },
          valid_from: 1,
          expires_at: null,
        },
      ],
    }),
  };
  const config = {
    get: jest.fn().mockReturnValue('billing'),
    getOrThrow: jest.fn().mockReturnValue('issuer'),
  };
  const entries = new Map<string, unknown>([['sso:session:session-id', {}]]);
  const store = {
    get: (key: string) => Promise.resolve(entries.get(key) ?? null),
    set: (key: string, value: unknown) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      entries.delete(key);
      return Promise.resolve();
    },
    withLock: async (
      _key: string,
      _ttl: number,
      callback: () => Promise<unknown>,
    ) => callback(),
  };
  return {
    accessClient,
    service: new BillingConsoleSessionService(
      accessClient as never,
      config as never,
      store as never,
    ),
  };
}

describe('Billing SSO integration', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('reuses GET/HEAD context but resolves every mutation freshly', async () => {
    const { service, accessClient } = serviceFixture();
    const request = requestFixture(accessOrganization());
    await service.resolve(request);
    await service.resolve(request);
    request.method = 'HEAD';
    await service.resolve(request);
    expect(accessClient.exchangeUserToken).toHaveBeenCalledTimes(1);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      request.method = method;
      await service.resolve(request);
    }
    expect(accessClient.resolveSystemContext).toHaveBeenCalledTimes(5);
  });

  it('does not cache invalid product claims', async () => {
    const { service, accessClient } = serviceFixture();
    const request = requestFixture(accessOrganization());
    accessClient.resolveSystemContext.mockResolvedValueOnce({
      sub: 'forged',
      contract_version: 1,
      catalog_version: 1,
    });
    await expect(service.resolve(request)).rejects.toThrow(ForbiddenException);
    await service.resolve(request);
    expect(accessClient.resolveSystemContext).toHaveBeenCalledTimes(2);
  });

  it('builds SSO config with billing scope and Access config', () => {
    process.env = {
      ...originalEnv,
      SSO_CLIENT_ID: 'billing',
      SSO_AUDIENCE: 'billing-api',
      SSO_REDIRECT_URI: 'http://localhost:3015/auth/callback',
      SSO_FRONTEND_URL: 'http://localhost:5175',
      ACCESS_API_URL: 'http://localhost:3019',
      PRODUCT_CODE: 'billing',
    };

    const cfg = ssoConfig();

    expect(cfg.scope).toContain('billing.access');
    expect(cfg.access).toEqual({
      apiBaseUrl: 'http://localhost:3019',
      jwksUrl: 'http://localhost:3019/.well-known/jwks.json',
      audience: 'access-api',
    });
  });

  it.each([
    [{ permissions: ['billing.access'] }, true],
    [{ scope: 'openid billing.access' }, true],
    [{ scope: 'openid' }, false],
    [{ permissions: ['billing.access', 'billing.disabled'] }, false],
    [{ scope: 'billing.access', permissions: ['billing.disabled'] }, false],
  ])(
    'requires Identity billing.access and respects explicit denial',
    async (claims, allowed) => {
      const cfg = buildSsoConfig({});
      expect(await cfg.authorize!(claims as never)).toBe(allowed);
    },
  );

  it.each([
    { organization_status: 'suspended' },
    { membership_status: 'inactive' },
    { product: { code: 'billing', status: 'disabled' } },
    { product: { code: 'legal', status: 'enabled' } },
    { product: { status: 'enabled' } },
    { product: { code: 'billing', status: 'enabled', disabled: true } },
  ])(
    'denies inactive or mismatched Access context even with billing.access: %j',
    async (overrides) => {
      const { service, accessClient } = serviceFixture();
      await expect(
        service.resolve(requestFixture(accessOrganization(overrides as never))),
      ).rejects.toThrow(ForbiddenException);
      expect(accessClient.resolveSystemContext).not.toHaveBeenCalled();
    },
  );

  it.each([
    { sub: 'other-user' },
    { organization_id: 'other-org' },
    { membership_id: 'other-membership' },
    { identity_reference_id: 'other-identity' },
    { product: { code: 'billing', status: 'disabled' } },
    { product: { code: 'legal', status: 'enabled' } },
    { global_roles: null },
    { permissions: ['billing.disabled'] },
  ])(
    'rejects signed context mismatch during authorization: %j',
    async (overrides) => {
      const { service, accessClient } = serviceFixture();
      const claims = (await accessClient.resolveSystemContext()) as Record<
        string,
        unknown
      >;
      accessClient.resolveSystemContext.mockResolvedValue({
        ...claims,
        ...overrides,
      });
      await expect(
        service.resolve(requestFixture(accessOrganization())),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it('derives local permissions from assignments, ignoring cached administrator roles', async () => {
    const { service } = serviceFixture();
    const session = await service.resolve(requestFixture(accessOrganization()));
    expect(session.permissions).toEqual([
      'billing.catalog.manage',
      'billing.catalog.publish',
      'billing.catalog.read',
      'billing.integrations.manage',
      'billing.integrations.read',
    ]);
    expect(session).not.toHaveProperty('tenantId');
  });
  it.each([[], null, [{ role_code: 'billing.*' }]])(
    'rejects missing or malformed assignments: %j',
    async (assignments) => {
      const { service, accessClient } = serviceFixture();
      const claims = (await accessClient.resolveSystemContext()) as Record<
        string,
        unknown
      >;
      accessClient.resolveSystemContext.mockResolvedValue({
        ...claims,
        assignments,
      });
      await expect(
        service.resolve(requestFixture(accessOrganization())),
      ).rejects.toThrow(ForbiddenException);
    },
  );
  it.each([403, 409, 503])(
    'preserves Access rejection status %i, without cached-role fallback',
    async (status) => {
      const { service, accessClient } = serviceFixture();
      accessClient.resolveSystemContext.mockRejectedValue(
        new AccessContextError(status, 'Access rejected'),
      );
      await expect(
        service.resolve(requestFixture(accessOrganization())),
      ).rejects.toMatchObject({ status });
    },
  );

  it('rejects organizations without Billing product access', async () => {
    const { service } = serviceFixture();

    await expect(
      service.resolve(
        requestFixture(
          accessOrganization({
            permissions: [],
            product: { code: 'billing', status: 'disabled' },
          }),
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('automatically uses the only organization with enabled product', async () => {
    const { service } = serviceFixture();
    const session = await service.resolve(
      requestFixture([
        accessOrganization(),
        accessOrganization({
          organization_id: 'other-org',
          product: { code: 'billing', status: 'disabled' },
        }),
      ]),
    );
    expect(session.organizationId).toBe(accessOrganization().organization_id);
  });

  it('validates a persisted selection against the signed context', async () => {
    const { service, accessClient } = serviceFixture();
    const request = requestFixture([
      accessOrganization(),
      accessOrganization({ organization_id: 'other-org' }),
    ]);
    request.cookies = {
      billing_organization: accessOrganization().organization_id,
    };
    expect((await service.resolve(request)).organizationId).toBe(
      accessOrganization().organization_id,
    );
    expect(accessClient.resolveSystemContext).toHaveBeenCalledWith(
      'access-token',
      {
        organization_id: accessOrganization().organization_id,
        product_code: 'billing',
        audience: 'billing-api',
      },
    );
  });

  it('rejects an unauthorized or revoked selection without switching organizations', async () => {
    const { service, accessClient } = serviceFixture();
    const request = requestFixture(accessOrganization());
    request.cookies = { billing_organization: 'unauthorized-org' };
    await expect(service.resolve(request)).rejects.toThrow(ConflictException);
    expect(accessClient.resolveSystemContext).not.toHaveBeenCalled();
    await expect(
      service.resolve(request, { allowOrganizationSelection: true }),
    ).resolves.toMatchObject({ requiresOrganizationSelection: true });
  });

  it('returns selection state only when explicitly allowed', async () => {
    const { service } = serviceFixture();
    const request = requestFixture([
      accessOrganization({
        organization_id: '8b2f71b1-56f5-4826-a587-84cbe26da3eb',
      }),
      accessOrganization({
        organization_id: '1a57869b-ef25-413e-9f55-91c465c21973',
      }),
    ]);

    await expect(service.resolve(request)).rejects.toThrow(ConflictException);
    await expect(
      service.resolve(request, { allowOrganizationSelection: true }),
    ).resolves.toMatchObject({
      requiresOrganizationSelection: true,
      permissions: [],
    });
  });

  it.each(['current-access-token', 'renewed-access-token'])(
    'uses the SDK session (%s) without exposing OAuth tokens',
    async (accessToken) => {
      const sso = {
        getSession: jest.fn().mockResolvedValue({
          id: 'session-id',
          user: { sub: 'user-id', email: 'user@example.com', name: 'User' },
          accessContext: requestFixture(accessOrganization()).accessContext,
          accessToken,
          refreshToken: 'refresh-token',
        }),
      };
      const consoleSession = {
        resolve: jest.fn().mockResolvedValue({
          authenticated: true,
          user: {
            ssoUserId: 'user-id',
            email: 'user@example.com',
            name: 'User',
          },
          organizationId: '8b2f71b1-56f5-4826-a587-84cbe26da3eb',
          permissions: ['billing.catalog.read'],
        }),
      };
      const response = { json: jest.fn() };

      await new AuthSessionMiddleware(
        sso as never,
        consoleSession as never,
        { cookieName: 'billing_session' } as never,
      ).use(
        { cookies: { billing_session: 'session-id' } } as never,
        response as never,
        jest.fn(),
      );

      expect(sso.getSession).toHaveBeenCalledWith('session-id');
      expect(consoleSession.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          user: { sub: 'user-id', email: 'user@example.com', name: 'User' },
          accessContext: requestFixture(accessOrganization()).accessContext,
          ssoAuth: {
            accessToken,
            cookie: 'session-id',
            authorization: `Bearer ${accessToken}`,
          },
        }),
        { allowOrganizationSelection: true },
      );
      const body: unknown = (response.json.mock.calls as unknown[][])[0][0];
      expect(body).toMatchObject({
        authenticated: true,
        permissions: ['billing.catalog.read'],
      });
      expect(JSON.stringify(body)).not.toContain(accessToken);
      expect(JSON.stringify(body)).not.toContain('refresh-token');
    },
  );
  it.each([
    [undefined, 'Missing session'],
    [{ unexpected: true }, 'Malformed session'],
    [['session-id'], 'Malformed session array'],
    ['unknown-session', 'Invalid session'],
    ['expired-session', 'Refresh failed'],
  ])(
    'propagates SDK failure for %s without resolving Billing access',
    async (sessionId, message) => {
      const error = new UnauthorizedError(message);
      const sso = { getSession: jest.fn().mockRejectedValue(error) };
      const consoleSession = { resolve: jest.fn() };
      const response = { json: jest.fn() };
      const middleware = new AuthSessionMiddleware(
        sso as never,
        consoleSession as never,
        { cookieName: 'billing_session' } as never,
      );
      await expect(
        middleware.use(
          { cookies: { billing_session: sessionId } } as never,
          response as never,
          jest.fn(),
        ),
      ).rejects.toBe(error);
      expect(sso.getSession).toHaveBeenCalledWith(
        typeof sessionId === 'string' ? sessionId : undefined,
      );
      expect(consoleSession.resolve).not.toHaveBeenCalled();
      expect(response.json).not.toHaveBeenCalled();
    },
  );
});

describe('Billing organization selection endpoint', () => {
  const organizationId = '1a57869b-ef25-413e-9f55-91c465c21973';
  const config = {
    frontendUrl: 'https://billing.hemia.cloud',
    cookieSecure: true,
    sessionTtlSeconds: 60,
  };

  it('sets a secure preference only after authorization succeeds', async () => {
    const sessions = {
      resolve: jest.fn().mockResolvedValue({ organizationId }),
    };
    const response = { cookie: jest.fn() };
    const request = { get: () => config.frontendUrl, cookies: {} };
    const controller = new BillingOrganizationController(
      sessions as never,
      config as never,
    );
    await controller.select(
      { organizationId },
      request as never,
      response as never,
    );
    expect(sessions.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        cookies: { billing_organization: organizationId },
      }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'billing_organization',
      organizationId,
      {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60000,
      },
    );
  });

  it('does not persist a rejected selection', async () => {
    const sessions = {
      resolve: jest.fn().mockRejectedValue(new ForbiddenException()),
    };
    const response = { cookie: jest.fn() };
    const controller = new BillingOrganizationController(
      sessions as never,
      config as never,
    );
    await expect(
      controller.select(
        { organizationId },
        {
          get: () => config.frontendUrl,
          cookies: {},
        } as never,
        response as never,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it.each([undefined, 'https://untrusted.example'])(
    'rejects an untrusted origin %s',
    async (origin) => {
      const sessions = { resolve: jest.fn() };
      const response = { cookie: jest.fn() };
      const controller = new BillingOrganizationController(
        sessions as never,
        config as never,
      );
      await expect(
        controller.select(
          { organizationId },
          {
            get: () => origin,
            cookies: {},
          } as never,
          response as never,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(sessions.resolve).not.toHaveBeenCalled();
      expect(response.cookie).not.toHaveBeenCalled();
    },
  );
});
