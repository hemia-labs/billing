import { ConfigService } from '@nestjs/config';
import { SecretsService } from '@hemia/secrets/nestjs';
import type { SsoConfig } from '@hemia/auth';
import * as Joi from 'joi';
import { buildSsoConfig } from '../../config/sso.config';

const url = () => Joi.string().uri({ scheme: ['http', 'https'] });
const schema = Joi.object<Record<string, unknown>>({
  SSO_ISSUER: url().required(),
  SSO_CLIENT_ID: Joi.string().required(),
  SSO_CLIENT_SECRET: Joi.string().allow(''),
  SSO_AUDIENCE: Joi.string().required(),
  SSO_REDIRECT_URI: url().required(),
  SSO_FRONTEND_URL: url().required(),
  SSO_JWKS_URL: url().allow(''),
  SSO_AUTHORIZATION_URL: url().allow(''),
  SSO_TOKEN_URL: url().allow(''),
  SSO_REVOCATION_URL: url().allow(''),
  SSO_LOGOUT_URL: url().allow(''),
  SSO_SCOPE: Joi.string(),
  SSO_COOKIE_NAME: Joi.string(),
  SSO_SESSION_TTL_SECONDS: Joi.number().integer().positive(),
  SSO_COOKIE_SECURE: Joi.boolean(),
  PRODUCT_CODE: Joi.string().valid('billing'),
  ACCESS_API_URL: url().required(),
  ACCESS_JWKS_URI: url(),
  ACCESS_AUDIENCE: Joi.string(),
}).required();

export async function resolveSsoConfig(
  config: ConfigService,
  secrets: SecretsService | null,
): Promise<SsoConfig> {
  if (!config.get<boolean>('secrets.enabled')) {
    return config.getOrThrow<SsoConfig>('sso');
  }
  const path = config.getOrThrow<string>('secrets.ssoPath');
  const secret = await secrets!.getRequired<unknown>(path);
  if (!secret || typeof secret !== 'object' || Array.isArray(secret)) {
    throw new Error('SSO secret must be an object');
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(secret)) {
    const name = key.toUpperCase();
    if (Object.hasOwn(normalized, name))
      throw new Error('Duplicate SSO secret key');
    normalized[name] = value;
  }
  const validation = schema.validate(normalized, { abortEarly: false });
  const { error } = validation;
  const value: Record<string, unknown> = validation.value as Record<
    string,
    unknown
  >;
  if (error) {
    // Report field names only: Joi messages may contain secret values.
    throw new Error(
      `Invalid SSO secret fields: ${error.details.map((detail) => detail.path.join('.')).join(', ')}`,
    );
  }
  const env: Record<string, string | undefined> = {
    NODE_ENV: config.getOrThrow<string>('app.nodeEnv'),
  };
  for (const [key, item] of Object.entries(value)) {
    if (item !== '') env[key] = String(item);
  }
  const resolved = buildSsoConfig(env);
  // Other features read sso.frontendUrl through ConfigService at request time.
  config.set('sso', resolved);
  return resolved;
}
