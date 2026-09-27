import type { Category, Environment } from '@hemia/secrets';
import { registerAs } from '@nestjs/config';

export default registerAs('secrets', () => ({
  ssoPath: process.env.SECRETS_SSO_PATH ?? 'auth/sso',
  enabled: process.env.SECRETS_ENABLED === 'true',
  environment: (process.env.SECRETS_ENVIRONMENT ?? 'dev') as Environment,
  category: (process.env.SECRETS_CATEGORY ?? 'internal') as Category,
  owner: process.env.SECRETS_OWNER ?? 'hemia',
  system: process.env.SECRETS_SYSTEM ?? 'billing',
  baseUrl: process.env.VAULT_BASE_URL ?? '',
  roleId: process.env.VAULT_ROLE_ID ?? '',
  secretId: process.env.VAULT_SECRET_ID ?? '',
  authPath: process.env.VAULT_AUTH_PATH ?? 'approle',
  mountPrefix: process.env.VAULT_MOUNT_PREFIX ?? 'kv-',
  timeoutMs: Number(process.env.VAULT_TIMEOUT_MS) || 5000,
  cacheEnabled: process.env.SECRETS_CACHE_ENABLED === 'true',
  cacheTtlMs: Number(process.env.SECRETS_CACHE_TTL_MS) || 60000,
}));
