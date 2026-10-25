import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from 'dotenv';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SecretsService } from '@hemia/secrets/nestjs';
import { environmentFile } from '../../../../apps/api/src/config/env-file';
import { SecretsModule } from '../../../../apps/api/src/modules/secrets/secrets.module';

describe('environment file loading', () => {
  const originalEnvironment = process.env;
  let directory: string;

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    directory = mkdtempSync(join(tmpdir(), 'billing-env-'));
    writeFileSync(
      join(directory, '.env.production'),
      'BILLING_ENV_SOURCE=production\nREDIS_DB=1\nSECRETS_ENABLED=false\n',
    );
    writeFileSync(
      join(directory, '.env.local'),
      'BILLING_ENV_SOURCE=development\nSECRETS_ENABLED=true\n',
    );
    writeFileSync(join(directory, '.env'), 'BILLING_ENV_SOURCE=unselected\n');
  });

  afterEach(() => {
    process.env = originalEnvironment;
    rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    ['production', 'production'],
    ['development', 'development'],
    ['test', 'development'],
    [undefined, 'development'],
  ])('loads the selected file for NODE_ENV=%s', (mode, expected) => {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    const environment: Record<string, string> = {};
    const result = config({
      path: join(directory, environmentFile()),
      processEnv: environment,
      quiet: true,
    });
    expect(result.error).toBeUndefined();
    expect(environment.BILLING_ENV_SOURCE).toBe(expected);
  });

  it('does not fall back to development when the production file is absent', () => {
    process.env.NODE_ENV = 'production';
    rmSync(join(directory, '.env.production'));
    const environment: Record<string, string> = {};
    config({
      path: join(directory, environmentFile()),
      processEnv: environment,
      quiet: true,
    });
    expect(environment.BILLING_ENV_SOURCE).toBeUndefined();
  });

  it('preserves variables injected by the deployment', () => {
    process.env.NODE_ENV = 'production';
    const environment = { BILLING_ENV_SOURCE: 'injected' };
    config({
      path: join(directory, environmentFile()),
      processEnv: environment,
      quiet: true,
    });
    expect(environment.BILLING_ENV_SOURCE).toBe('injected');
  });

  it('loads the production file in Nest without creating a Vault client', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SECRETS_ENABLED;
    delete process.env.BILLING_ENV_SOURCE;
    delete process.env.REDIS_DB;
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          envFilePath: join(directory, environmentFile()),
        }),
        SecretsModule,
      ],
    }).compile();
    try {
      expect(module.get(ConfigService).get('BILLING_ENV_SOURCE')).toBe(
        'production',
      );
      expect(module.get(ConfigService).get('REDIS_DB')).toBe('1');
      expect(module.get(SecretsService)).toBeNull();
    } finally {
      await module.close();
    }
  });
});
