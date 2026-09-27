import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SecretsService } from '@hemia/secrets/nestjs';
import { SecretsModule } from '../src/modules/secrets/secrets.module';
import { resolveDatabaseOptions } from '../src/database/database.module';
import { createRedis } from '../src/modules/auth/redis.module';
import { resolveSsoConfig } from '../src/modules/auth/sso-vault.config';
import ssoConfig, { buildSsoConfig } from '../src/config/sso.config';
import { envVarsSchema } from '../src/config/env.validation';

const config = new ConfigService({
  secrets: { enabled: true, ssoPath: 'auth/sso' },
  app: { nodeEnv: 'production' },
  database: { host: 'env-db' },
  redis: { host: 'env-redis', port: 6379 },
});
const client = (value: unknown) =>
  ({
    getRequired: jest.fn().mockResolvedValue(value),
  }) as unknown as SecretsService;
const sso = {
  sso_issuer: 'https://id.example.com',
  sso_client_id: 'billing-web',
  sso_client_secret: 'test-secret',
  sso_audience: 'billing-api',
  sso_redirect_uri: 'https://api.example.com/auth/callback',
  sso_frontend_url: 'https://billing.example.com',
  access_api_url: 'https://access.example.com',
};

describe('Vault configuration', () => {
  it('ignores inactive DB, Redis, SSO and Access environment values with Vault enabled', () => {
    const result = envVarsSchema.validate({
      SECRETS_ENABLED: true,
      VAULT_BASE_URL: 'https://vault.example.com',
      VAULT_ROLE_ID: 'role',
      VAULT_SECRET_ID: 'secret',
      DB_PORT: 'not-a-port',
      REDIS_PORT: 'not-a-port',
      REDIS_DB: -1,
      SSO_ISSUER: '',
      SSO_SESSION_TTL_SECONDS: 'invalid',
      ACCESS_API_URL: 'invalid',
    });
    expect(result.error).toBeUndefined();
    expect(result.value).not.toHaveProperty('SSO_ISSUER');
    expect(result.value).not.toHaveProperty('REDIS_PORT');
  });

  it('does not build environment SSO before Vault resolution', () => {
    const original = process.env;
    process.env = {
      ...original,
      SECRETS_ENABLED: 'true',
      SSO_ISSUER: 'invalid',
      SSO_SESSION_TTL_SECONDS: 'invalid',
    };
    try {
      expect(ssoConfig()).toEqual({});
    } finally {
      process.env = original;
    }
  });

  it('uses one production cookie policy for both sources', async () => {
    const env = Object.fromEntries(
      Object.entries(sso).map(([key, value]) => [key.toUpperCase(), value]),
    );
    expect(() =>
      buildSsoConfig({
        ...env,
        NODE_ENV: 'production',
      AMQP_URL: 'amqp://localhost:5672',
        SSO_COOKIE_SECURE: 'false',
      }),
    ).toThrow('must be true');
    await expect(
      resolveSsoConfig(config, client({ ...sso, sso_cookie_secure: false })),
    ).rejects.toThrow('must be true');
    expect(
      buildSsoConfig({ ...env, NODE_ENV: 'production' }).cookieSecure,
    ).toBe(true);
  });

  it('derives optional endpoints from the effective issuer when env values are empty', () => {
    expect(
      buildSsoConfig({
        SSO_ISSUER: 'https://identity.example.com',
        SSO_JWKS_URL: '',
        SSO_TOKEN_URL: '',
        SSO_AUTHORIZATION_URL: '',
      }),
    ).toMatchObject({
      jwksUrl: 'https://identity.example.com/.well-known/jwks.json',
      tokenUrl: 'https://identity.example.com/oauth/token',
      authorizationUrl: 'https://identity.example.com/oauth/authorize',
    });
  });

  it('rejects missing production Redis passwords from either source', async () => {
    await expect(
      createRedis(
        config,
        client({
          redis_host: 'redis',
          redis_port: 6379,
          redis_db: 0,
          redis_password: '',
        }),
      ),
    ).rejects.toThrow('password is required');
    const env = new ConfigService({
      secrets: { enabled: false },
      app: { nodeEnv: 'production' },
      redis: { host: 'redis', port: 6379, db: 0 },
    });
    await expect(createRedis(env, null)).rejects.toThrow(
      'password is required',
    );
  });

  it('validates effective environment database options before creating a connection', async () => {
    await expect(
      resolveDatabaseOptions(
        new ConfigService({ database: { host: '' } }),
        null,
      ),
    ).rejects.toThrow('Database configuration');
  });

  it('requires JWKS, audience and either issuer for production integrations', () => {
    const bootstrap = {
      NODE_ENV: 'production',
      AMQP_URL: 'amqp://localhost:5672',
      SECRETS_ENABLED: true,
      VAULT_BASE_URL: 'https://vault.example.com',
      VAULT_ROLE_ID: 'role',
      VAULT_SECRET_ID: 'secret',
      AUTH_JWKS_URI: 'https://identity.example.com/jwks',
      AUTH_AUDIENCE: 'billing-integrations',
    };
    expect(envVarsSchema.validate(bootstrap).error).toBeDefined();
    for (const issuer of ['AUTH_ISSUER_URL', 'AUTH_REQUIRED_ISSUER']) {
      const valid = { ...bootstrap, [issuer]: 'https://identity.example.com' };
      expect(envVarsSchema.validate(valid).error).toBeUndefined();
      expect(
        envVarsSchema.validate({ ...valid, AUTH_AUDIENCE: '' }).error,
      ).toBeDefined();
      expect(
        envVarsSchema.validate({ ...valid, AUTH_JWKS_URI: '' }).error,
      ).toBeDefined();
    }
  });

  it('maps database secrets and keeps synchronize disabled', async () => {
    const secrets = client({
      db_host: 'vault-db',
      db_port: 5433,
      db_username: 'billing',
      db_password: 'secret',
      db_database: 'billing',
      db_logging: false,
    });
    await expect(
      resolveDatabaseOptions(config, secrets),
    ).resolves.toMatchObject({
      host: 'vault-db',
      port: 5433,
      username: 'billing',
      password: 'secret',
      database: 'billing',
      synchronize: false,
    });
    expect(secrets.getRequired).toHaveBeenCalledWith('database/postgres');
  });

  it('uses the Vault Redis port and database without connecting during construction', async () => {
    const secrets = client({
      redis_host: 'vault-redis',
      redis_port: 6380,
      redis_password: 'secret',
      redis_db: 4,
    });
    const redis = await createRedis(config, secrets);
    try {
      expect(redis.options).toMatchObject({
        host: 'vault-redis',
        port: 6380,
        db: 4,
        password: 'secret',
      });
      expect(redis.status).toBe('wait');
      expect(secrets.getRequired).toHaveBeenCalledWith('cache/redis');
    } finally {
      redis.disconnect();
    }
  });

  it('rejects malformed database and Redis secrets before connecting', async () => {
    await expect(
      resolveDatabaseOptions(config, client({ db_password: 'do-not-print' })),
    ).rejects.toThrow('must contain');
    await expect(
      createRedis(
        config,
        client({
          redis_host: '',
          redis_port: 70000,
          redis_db: 0,
          redis_password: '',
        }),
      ),
    ).rejects.toThrow('must contain');
  });

  it('builds SSO endpoints and permission hooks from the configured secret', async () => {
    const secrets = client(sso);
    const resolved = await resolveSsoConfig(config, secrets);
    expect(config.get('sso.frontendUrl')).toBe(sso.sso_frontend_url);
    expect(secrets.getRequired).toHaveBeenCalledWith('auth/sso');
    expect(resolved).toMatchObject({
      issuer: sso.sso_issuer,
      tokenUrl: `${sso.sso_issuer}/oauth/token`,
      cookieSecure: true,
      requireDistributedRefreshLock: true,
      access: { apiBaseUrl: sso.access_api_url },
    });
    expect(
      await resolved.authorize!({ scope: 'billing.access' } as never),
    ).toBe(true);
    expect(
      await resolved.authorize!({
        scope: 'billing.access billing.disabled',
      } as never),
    ).toBe(false);
  });

  it('accepts uppercase SSO keys and rejects insecure production cookies', async () => {
    const uppercase = Object.fromEntries(
      Object.entries(sso).map(([key, value]) => [key.toUpperCase(), value]),
    );
    await expect(
      resolveSsoConfig(config, client(uppercase)),
    ).resolves.toHaveProperty('clientId', 'billing-web');
    await expect(
      resolveSsoConfig(config, client({ ...sso, sso_cookie_secure: false })),
    ).rejects.toThrow('must be true');
  });

  it('rejects malformed SSO secrets without exposing values and propagates Vault failures', async () => {
    await expect(
      resolveSsoConfig(config, client({ ...sso, sso_issuer: 'do-not-print' })),
    ).rejects.toThrow('Invalid SSO secret fields: SSO_ISSUER');
    const secrets = client(null);
    jest
      .mocked(secrets.getRequired)
      .mockRejectedValue(new Error('Vault unavailable'));
    await expect(resolveSsoConfig(config, secrets)).rejects.toThrow(
      'Vault unavailable',
    );
  });

  it('preserves environment mode including Redis port without using Vault', async () => {
    const env = new ConfigService({
      secrets: { enabled: false },
      database: {
        host: 'local-db',
        port: 5432,
        username: 'billing',
        password: '',
        name: 'billing',
        logging: false,
      },
      redis: { host: 'localhost', port: 6381, db: 0 },
      sso: { clientId: 'local-client' },
    });
    await expect(resolveDatabaseOptions(env, null)).resolves.toHaveProperty(
      'host',
      'local-db',
    );
    await expect(resolveSsoConfig(env, null)).resolves.toHaveProperty(
      'clientId',
      'local-client',
    );
    const redis = await createRedis(env, null);
    expect(redis.options.port).toBe(6381);
    redis.disconnect();
  });

  it('does not construct an AppRole client when Vault is disabled', async () => {
    const original = process.env.SECRETS_ENABLED;
    process.env.SECRETS_ENABLED = 'false';
    try {
      const module = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), SecretsModule],
      }).compile();
      expect(module.get(SecretsService)).toBeNull();
      await module.close();
    } finally {
      if (original === undefined) delete process.env.SECRETS_ENABLED;
      else process.env.SECRETS_ENABLED = original;
    }
  });

  it('requires bootstrap credentials but not duplicated DB/Redis/SSO env in Vault mode', () => {
    const env = {
      NODE_ENV: 'production',
      AMQP_URL: 'amqp://localhost:5672',
      SECRETS_ENABLED: true,
      VAULT_BASE_URL: 'https://vault.example.com',
      VAULT_ROLE_ID: 'role',
      VAULT_SECRET_ID: 'secret',
      AUTH_ISSUER_URL: 'https://id.example.com',
      AUTH_JWKS_URI: 'https://id.example.com/jwks',
      AUTH_AUDIENCE: 'billing-api',
      AUTH_REQUIRED_ISSUER: 'https://id.example.com',
    };
    expect(envVarsSchema.validate(env).error).toBeUndefined();
    expect(envVarsSchema.validate(env).value.SECRETS_SSO_PATH).toBe('auth/sso');
    expect(
      envVarsSchema.validate({ ...env, VAULT_ROLE_ID: undefined }).error,
    ).toBeDefined();
    expect(
      envVarsSchema.validate({ ...env, SECRETS_ENABLED: false }).error,
    ).toBeDefined();
  });
});
