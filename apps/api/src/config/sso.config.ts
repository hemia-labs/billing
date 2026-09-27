import { registerAs } from '@nestjs/config';
import { validateConfig, type SsoConfig } from '@hemia/auth';

const withoutTrailingSlash = (value: string): string =>
  value.replace(/\/$/, '');

export function buildSsoConfig(
  env: Record<string, string | undefined>,
): SsoConfig {
  env = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value === '' ? undefined : value,
    ]),
  );
  const issuer = withoutTrailingSlash(
    env.SSO_ISSUER ?? 'http://localhost:4000',
  );
  const accessApiUrl = withoutTrailingSlash(
    env.ACCESS_API_URL ?? 'http://localhost:3019',
  );
  const productCode = env.PRODUCT_CODE ?? 'billing';
  const scope =
    env.SSO_SCOPE ??
    `openid profile email offline_access ${productCode}.access`;

  if (env.NODE_ENV === 'production' && env.SSO_COOKIE_SECURE === 'false') {
    throw new Error('SSO_COOKIE_SECURE must be true in production');
  }

  return validateConfig({
    issuer,
    clientId: env.SSO_CLIENT_ID ?? 'billing',
    clientSecret: env.SSO_CLIENT_SECRET || undefined,
    audience: env.SSO_AUDIENCE ?? 'billing-api',
    jwksUrl: env.SSO_JWKS_URL ?? `${issuer}/.well-known/jwks.json`,
    authorizationUrl: env.SSO_AUTHORIZATION_URL ?? `${issuer}/oauth/authorize`,
    tokenUrl: env.SSO_TOKEN_URL ?? `${issuer}/oauth/token`,
    revocationUrl: env.SSO_REVOCATION_URL || `${issuer}/oauth/revoke`,
    logoutUrl: env.SSO_LOGOUT_URL || `${issuer}/oauth/logout`,
    redirectUri: env.SSO_REDIRECT_URI ?? 'http://localhost:3015/auth/callback',
    frontendUrl: env.SSO_FRONTEND_URL ?? 'http://localhost:5175',
    scope,
    productCode,
    cookieName: env.SSO_COOKIE_NAME ?? 'billing_session',
    sessionTtlSeconds: Number(env.SSO_SESSION_TTL_SECONDS ?? 604800),
    requireDistributedRefreshLock: true,
    cookieSecure:
      env.SSO_COOKIE_SECURE === undefined
        ? env.NODE_ENV === 'production'
        : env.SSO_COOKIE_SECURE === 'true',
    access: {
      apiBaseUrl: accessApiUrl,
      jwksUrl: env.ACCESS_JWKS_URI ?? `${accessApiUrl}/.well-known/jwks.json`,
      audience: env.ACCESS_AUDIENCE ?? 'access-api',
    },
    authorize: (claims) => {
      const permissions = claimStrings(claims.permissions);
      const scopes = claimStrings(claims.scope);
      const granted = new Set([...permissions, ...scopes]);

      return (
        granted.has(`${productCode}.access`) &&
        !granted.has(`${productCode}.disabled`)
      );
    },
    onUserResolved: async (user) => ({ internalUserId: user.sub }),
  });
}

export default registerAs('sso', (): Partial<SsoConfig> =>
  process.env.SECRETS_ENABLED === 'true' ? {} : buildSsoConfig(process.env),
);

const claimStrings = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return value
      .split(' ')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return [];
};
