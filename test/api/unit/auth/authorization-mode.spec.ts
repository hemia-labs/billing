import authorizationConfig from '../../../../apps/api/src/config/authorization.config';
import { envVarsSchema } from '../../../../apps/api/src/config/env.validation';

const environment = {
  NODE_ENV: 'test',
  SECRETS_ENABLED: true,
  VAULT_BASE_URL: 'https://vault.example.test',
  VAULT_ROLE_ID: 'role',
  VAULT_SECRET_ID: 'secret',
};

describe('role-based authorization configuration', () => {
  const original = process.env;
  afterEach(() => {
    process.env = original;
  });

  it('requires roles by default and accepts the explicit roles setting', () => {
    for (const mode of [undefined, 'roles']) {
      process.env = { ...original };
      if (mode === undefined) delete process.env.HEMIA_AUTHORIZATION_MODE;
      else process.env.HEMIA_AUTHORIZATION_MODE = mode;
      expect(authorizationConfig()).toEqual({ mode: 'roles' });
      const result = envVarsSchema.validate({
        ...environment,
        ...(mode ? { HEMIA_AUTHORIZATION_MODE: mode } : {}),
      });
      expect(result.error).toBeUndefined();
      expect(result.value).toEqual(
        expect.objectContaining({ HEMIA_AUTHORIZATION_MODE: 'roles' }),
      );
    }
  });

  it.each(['authenticated', '', 'unknown'])(
    'rejects %j before startup',
    (mode) => {
      process.env = { ...original, HEMIA_AUTHORIZATION_MODE: mode };
      expect(() => authorizationConfig()).toThrow(
        'HEMIA_AUTHORIZATION_MODE must be roles',
      );
      const result = envVarsSchema.validate({
        ...environment,
        HEMIA_AUTHORIZATION_MODE: mode,
      });
      expect(result.error?.message).toContain('HEMIA_AUTHORIZATION_MODE');
    },
  );
});
