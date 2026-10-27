import * as Joi from 'joi';

const hasValue = (value?: string): boolean => Boolean(value?.trim());

const schema = Joi.object({
  HEMIA_AUTHORIZATION_MODE: Joi.string()
    .valid('roles', 'authenticated')
    .default('roles'),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  EVENT_BUS_ENABLED: Joi.boolean().default(false),
  EVENT_BUS_PREFETCH: Joi.number().integer().min(1).max(100).default(10),
  AMQP_URL: Joi.string()
    .uri({ scheme: ['amqp', 'amqps'] })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.when('EVENT_BUS_ENABLED', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional(),
      }),
    }),
  PORT: Joi.number().port().default(3015),
  APP_GLOBAL_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGINS: Joi.string().default(
    'http://localhost:5175,http://localhost:3015',
  ),
  AUTH_ISSUER_URL: Joi.string().uri().allow('').default(''),
  AUTH_JWKS_URI: Joi.string().uri().allow('').default(''),
  AUTH_AUDIENCE: Joi.string().allow('').default(''),
  AUTH_REQUIRED_ISSUER: Joi.string().uri().allow('').default(''),
  SECRETS_ENABLED: Joi.boolean().default(false),
  SECRETS_ENVIRONMENT: Joi.string()
    .valid('dev', 'qa', 'staging', 'prod')
    .default('dev'),
  SECRETS_CATEGORY: Joi.string()
    .valid(
      'internal',
      'external',
      'clients',
      'partners',
      'whitelabel',
      'shared',
    )
    .default('internal'),
  SECRETS_OWNER: Joi.string().default('hemia'),
  SECRETS_SYSTEM: Joi.string().default('billing'),
  SECRETS_SSO_PATH: Joi.string().default('auth/sso'),
  VAULT_BASE_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .when('SECRETS_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  VAULT_ROLE_ID: Joi.string().when('SECRETS_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  VAULT_SECRET_ID: Joi.string().when('SECRETS_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  VAULT_AUTH_PATH: Joi.string().default('approle'),
  VAULT_MOUNT_PREFIX: Joi.string().default('kv-'),
  VAULT_TIMEOUT_MS: Joi.number().integer().positive().default(5000),
  SECRETS_CACHE_ENABLED: Joi.boolean().default(false),
  SECRETS_CACHE_TTL_MS: Joi.number().integer().positive().default(60000),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_HOST: Joi.string().hostname().optional(),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().integer().min(0).optional(),
  SSO_ISSUER: Joi.string().uri().optional(),
  SSO_CLIENT_ID: Joi.string().optional(),
  SSO_CLIENT_SECRET: Joi.string().allow('').optional(),
  SSO_AUDIENCE: Joi.string().optional(),
  SSO_JWKS_URL: Joi.string().uri().allow('').optional(),
  SSO_AUTHORIZATION_URL: Joi.string().uri().allow('').optional(),
  SSO_TOKEN_URL: Joi.string().uri().allow('').optional(),
  SSO_REVOCATION_URL: Joi.string().uri().allow('').optional(),
  SSO_LOGOUT_URL: Joi.string().uri().allow('').optional(),
  SSO_REDIRECT_URI: Joi.string().uri().optional(),
  SSO_FRONTEND_URL: Joi.string().uri().optional(),
  SSO_SCOPE: Joi.string().optional(),
  SSO_COOKIE_NAME: Joi.string().optional(),
  SSO_SESSION_TTL_SECONDS: Joi.number().integer().positive().default(604800),
  SSO_COOKIE_SECURE: Joi.boolean().optional(),
  PRODUCT_CODE: Joi.string().default('billing'),
  ACCESS_API_URL: Joi.string().uri().optional(),
  ACCESS_JWKS_URI: Joi.string().uri().optional(),
  ACCESS_AUDIENCE: Joi.string().default('access-api'),
  PAYPAL_ENV: Joi.string().valid('sandbox', 'live').default('sandbox'),
  PAYPAL_CLIENT_ID: Joi.string().allow('').default(''),
  PAYPAL_CLIENT_SECRET: Joi.string().allow('').default(''),
  PAYPAL_WEBHOOK_ID: Joi.string().allow('').default(''),
  PAYPAL_API_BASE_URL: Joi.string().uri().optional(),
  FEVEX_MODELS: Joi.string()
    .max(2048)
    .pattern(
      /^\s*(?:deepseek|openai):[^,\s]+(?:\s*,\s*(?:deepseek|openai):[^,\s]+)*\s*$/,
    )
    .optional(),
  DEEPSEEK_API_KEY: Joi.string().allow('').optional(),
  OPENAI_API_KEY: Joi.string().allow('').optional(),
  OPENAI_PROJECT_ID: Joi.string().allow('').optional(),
  HEMIA_LEGAL_BASE_URL: Joi.string().uri().allow('').default(''),
  HEMIA_LEGAL_TOKEN_URL: Joi.string().uri().allow('').default(''),
  HEMIA_LEGAL_CLIENT_ID: Joi.string().default('billing-legal-service'),
  HEMIA_LEGAL_CLIENT_SECRET: Joi.string().allow('').default(''),
  BILLING_FISCAL_PROVIDER: Joi.string().default('noop'),
  BILLING_FISCAL_API_BASE_URL: Joi.string().uri().allow('').default(''),
  BILLING_FISCAL_API_KEY: Joi.string().allow('').default(''),
  BILLING_FISCAL_STORAGE_ENDPOINT: Joi.string().uri().allow('').default(''),
  BILLING_FISCAL_STORAGE_BUCKET: Joi.string().allow('').default(''),
  BILLING_FISCAL_STORAGE_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  BILLING_FISCAL_STORAGE_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  DB_HOST: Joi.string().when('SECRETS_ENABLED', {
    is: true,
    then: Joi.optional().allow(''),
    otherwise: Joi.required(),
  }),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().when('SECRETS_ENABLED', {
    is: true,
    then: Joi.optional().allow(''),
    otherwise: Joi.required(),
  }),
  DB_PASSWORD: Joi.string().allow('').when('SECRETS_ENABLED', {
    is: true,
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  DB_DATABASE: Joi.string().when('SECRETS_ENABLED', {
    is: true,
    then: Joi.optional().allow(''),
    otherwise: Joi.required(),
  }),
  DB_LOGGING: Joi.boolean().default(false),
}).custom((env: Record<string, unknown>, helpers) => {
  const nodeEnv = env.NODE_ENV as string;
  const corsOrigins = (env.CORS_ORIGINS as string)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const authIssuerUrl = env.AUTH_ISSUER_URL as string;
  const authJwksUri = env.AUTH_JWKS_URI as string;
  const authAudience = env.AUTH_AUDIENCE as string;
  const authRequiredIssuer = env.AUTH_REQUIRED_ISSUER as string;
  const paypalEnv = env.PAYPAL_ENV as string;
  const paypalApiBaseUrl = env.PAYPAL_API_BASE_URL as string | undefined;

  if (nodeEnv === 'production') {
    if (corsOrigins.length === 0 || corsOrigins.includes('*')) {
      return helpers.error('any.invalid', {
        message: 'CORS_ORIGINS must be an explicit allowlist in production',
      });
    }

    if (
      !hasValue(authJwksUri) ||
      !hasValue(authAudience) ||
      (!hasValue(authRequiredIssuer) && !hasValue(authIssuerUrl))
    ) {
      return helpers.error('any.invalid', {
        message:
          'AUTH_JWKS_URI, AUTH_AUDIENCE and an issuer (AUTH_REQUIRED_ISSUER or AUTH_ISSUER_URL) are required in production',
      });
    }

    if (
      !env.SECRETS_ENABLED &&
      (!hasValue(env.REDIS_HOST as string) ||
        !hasValue(env.REDIS_PASSWORD as string) ||
        env.REDIS_DB === undefined ||
        !hasValue(env.SSO_ISSUER as string) ||
        !hasValue(env.SSO_CLIENT_ID as string) ||
        !hasValue(env.SSO_AUDIENCE as string) ||
        !hasValue(env.SSO_REDIRECT_URI as string) ||
        !hasValue(env.SSO_FRONTEND_URL as string) ||
        !hasValue(env.ACCESS_API_URL as string) ||
        !hasValue(env.ACCESS_JWKS_URI as string))
    ) {
      return helpers.error('any.invalid', {
        message:
          'REDIS_HOST, REDIS_PASSWORD, REDIS_DB, SSO_ISSUER, SSO_CLIENT_ID, SSO_AUDIENCE, SSO_REDIRECT_URI, SSO_FRONTEND_URL, ACCESS_API_URL and ACCESS_JWKS_URI are required in production',
      });
    }
  }

  if (
    nodeEnv === 'production' &&
    paypalEnv === 'live' &&
    paypalApiBaseUrl?.includes('sandbox')
  ) {
    return helpers.error('any.invalid', {
      message:
        'PAYPAL_API_BASE_URL cannot point to sandbox when PAYPAL_ENV=live',
    });
  }

  return env;
});

// Ignore inactive environment values; the selected Vault payload is validated
// by the consuming factory before creating connections or authentication.
const vaultFields = Object.keys(
  (schema.describe() as { keys: Record<string, unknown> }).keys,
).filter((key) => /^(DB_|REDIS_|SSO_|ACCESS_)/.test(key));
export const envVarsSchema = schema.fork(vaultFields, (field) =>
  Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.any().strip(),
    otherwise: field,
  }),
);
