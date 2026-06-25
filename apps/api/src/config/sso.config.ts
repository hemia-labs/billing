import { registerAs } from '@nestjs/config';
import type { SsoConfig } from '@hemia/auth';

const withoutTrailingSlash = (value: string): string => value.replace(/\/$/, '');

export default registerAs('sso', (): SsoConfig => {
  const issuer = withoutTrailingSlash(
    process.env.SSO_ISSUER ?? 'http://localhost:4000',
  );

  return {
    issuer,
    clientId: process.env.SSO_CLIENT_ID ?? 'billing',
    clientSecret: process.env.SSO_CLIENT_SECRET || undefined,
    audience: process.env.SSO_AUDIENCE ?? 'billing-api',
    jwksUrl: process.env.SSO_JWKS_URL ?? `${issuer}/.well-known/jwks.json`,
    authorizationUrl: process.env.SSO_AUTHORIZATION_URL ?? `${issuer}/oauth/authorize`,
    tokenUrl: process.env.SSO_TOKEN_URL ?? `${issuer}/oauth/token`,
    revocationUrl: process.env.SSO_REVOCATION_URL || `${issuer}/oauth/revoke`,
    logoutUrl: process.env.SSO_LOGOUT_URL || `${issuer}/oauth/logout`,
    redirectUri: process.env.SSO_REDIRECT_URI ?? 'http://localhost:3015/api/v1/auth/callback',
    frontendUrl: process.env.SSO_FRONTEND_URL ?? 'http://localhost:5175',
    scope: process.env.SSO_SCOPE ?? 'openid profile email offline_access',
    cookieName: process.env.SSO_COOKIE_NAME ?? 'billing_session',
    sessionTtlSeconds: 7 * 24 * 60 * 60,
    cookieSecure: process.env.NODE_ENV === 'production',
    onUserResolved: async (user) => ({ internalUserId: user.ssoUserId }),
  };
});
