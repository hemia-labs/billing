import authorizationConfig from '../../../../apps/api/src/config/authorization.config';
import { envVarsSchema } from '../../../../apps/api/src/config/env.validation';

describe('Billing authorization mode configuration', () => {
  const originalEnvironment = process.env;
  afterEach(() => {
    process.env = originalEnvironment;
  });
  it('defaults to roles and allows the explicit authenticated setting in any environment', () => {
    process.env = { NODE_ENV: 'test' };
    expect(authorizationConfig().mode).toBe('roles');
    for (const nodeEnv of ['development', 'production']) {
      process.env = {
        NODE_ENV: nodeEnv,
        HEMIA_AUTHORIZATION_MODE: 'authenticated',
      };
      expect(authorizationConfig().mode).toBe('authenticated');
    }
  });
  it('rejects unsupported modes rather than silently enabling them', () => {
    const mode = envVarsSchema.extract('HEMIA_AUTHORIZATION_MODE');
    expect(mode.validate('authenticated').error).toBeUndefined();
    expect(mode.validate('roles').error).toBeUndefined();
    expect(mode.validate('disabled').error).toBeDefined();
  });
});
