import * as Joi from 'joi';

const minimumProductionSecretLength = 32;
const hasValue = (value?: string): boolean => Boolean(value?.trim());

export const envVarsSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3001),
  APP_GLOBAL_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGINS: Joi.string().default(
    'http://localhost:3000,http://localhost:3001',
  ),
  BILLING_INTERNAL_API_KEY: Joi.string().allow('').default(''),
  AUTH_ISSUER_URL: Joi.string().uri().allow('').default(''),
  AUTH_JWKS_URI: Joi.string().uri().allow('').default(''),
  AUTH_AUDIENCE: Joi.string().allow('').default(''),
  AUTH_REQUIRED_ISSUER: Joi.string().uri().allow('').default(''),
  AUTH_LEGACY_API_KEY_ENABLED: Joi.boolean().default(false),
  PAYPAL_ENV: Joi.string().valid('sandbox', 'live').default('sandbox'),
  PAYPAL_CLIENT_ID: Joi.string().allow('').default(''),
  PAYPAL_CLIENT_SECRET: Joi.string().allow('').default(''),
  PAYPAL_WEBHOOK_ID: Joi.string().allow('').default(''),
  PAYPAL_API_BASE_URL: Joi.string().uri().optional(),
  HEMIA_LEGAL_BASE_URL: Joi.string().uri().allow('').default(''),
  HEMIA_LEGAL_API_KEY: Joi.string().allow('').default(''),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_DATABASE: Joi.string().required(),
  DB_LOGGING: Joi.boolean().default(false),
}).custom((env, helpers) => {
  const nodeEnv = env.NODE_ENV as string;
  const corsOrigins = (env.CORS_ORIGINS as string)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const authIssuerUrl = env.AUTH_ISSUER_URL as string;
  const authJwksUri = env.AUTH_JWKS_URI as string;
  const authAudience = env.AUTH_AUDIENCE as string;
  const authRequiredIssuer = env.AUTH_REQUIRED_ISSUER as string;
  const legacyApiKeyEnabled = env.AUTH_LEGACY_API_KEY_ENABLED as boolean;
  const billingInternalApiKey = env.BILLING_INTERNAL_API_KEY as string;
  const paypalEnv = env.PAYPAL_ENV as string;
  const paypalApiBaseUrl = env.PAYPAL_API_BASE_URL as string | undefined;

  if (nodeEnv === 'production') {
    if (corsOrigins.length === 0 || corsOrigins.includes('*')) {
      return helpers.error('any.invalid', {
        message: 'CORS_ORIGINS must be an explicit allowlist in production',
      });
    }

    if (
      !hasValue(authIssuerUrl) ||
      !hasValue(authJwksUri) ||
      !hasValue(authAudience) ||
      !hasValue(authRequiredIssuer)
    ) {
      return helpers.error('any.invalid', {
        message:
          'AUTH_ISSUER_URL, AUTH_JWKS_URI, AUTH_AUDIENCE and AUTH_REQUIRED_ISSUER are required in production',
      });
    }

    if (legacyApiKeyEnabled) {
      return helpers.error('any.invalid', {
        message: 'AUTH_LEGACY_API_KEY_ENABLED cannot be true in production',
      });
    }
  }

  if (
    legacyApiKeyEnabled &&
    billingInternalApiKey.length < minimumProductionSecretLength
  ) {
    return helpers.error('any.invalid', {
      message:
        'BILLING_INTERNAL_API_KEY must be at least 32 characters when legacy API key auth is enabled',
    });
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
