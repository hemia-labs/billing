import { envVarsSchema } from 'src/config/env.validation';

const validEnv = {
  AUTH_AUDIENCE: 'billing-api',
  AUTH_ISSUER_URL: 'https://identity.example.com',
  AUTH_JWKS_URI: 'https://identity.example.com/.well-known/jwks.json',
  AUTH_REQUIRED_ISSUER: 'https://identity.example.com',
  CORS_ORIGINS: 'http://localhost:3000',
  DB_DATABASE: 'billing',
  DB_HOST: 'localhost',
  DB_PASSWORD: '',
  DB_USERNAME: 'postgres',
  NODE_ENV: 'development',
  PAYPAL_ENV: 'sandbox',
};

const validate = (env: Record<string, unknown>) =>
  envVarsSchema.validate(env, { allowUnknown: true });

describe('envVarsSchema', () => {
  it('allows valid development config', () => {
    const result = validate(validEnv);

    expect(result.error).toBeUndefined();
  });

  it('rejects production without OIDC config', () => {
    const result = validate({
      ...validEnv,
      AUTH_AUDIENCE: '',
      NODE_ENV: 'production',
    });

    expect(result.error).toBeDefined();
  });

  it('rejects production wildcard CORS', () => {
    const result = validate({
      ...validEnv,
      CORS_ORIGINS: '*',
      NODE_ENV: 'production',
    });

    expect(result.error).toBeDefined();
  });

  it('rejects live PayPal with sandbox override in production', () => {
    const result = validate({
      ...validEnv,
      NODE_ENV: 'production',
      PAYPAL_API_BASE_URL: 'https://api-m.sandbox.paypal.com',
      PAYPAL_ENV: 'live',
    });

    expect(result.error).toBeDefined();
  });

  it('rejects legacy API key auth in production', () => {
    const result = validate({
      ...validEnv,
      AUTH_LEGACY_API_KEY_ENABLED: true,
      BILLING_INTERNAL_API_KEY: 'x'.repeat(32),
      NODE_ENV: 'production',
    });

    expect(result.error).toBeDefined();
  });

  it('rejects weak legacy API key when enabled', () => {
    const result = validate({
      ...validEnv,
      AUTH_LEGACY_API_KEY_ENABLED: true,
      BILLING_INTERNAL_API_KEY: 'short',
    });

    expect(result.error).toBeDefined();
  });
});
