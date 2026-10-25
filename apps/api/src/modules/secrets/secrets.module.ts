import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createSecretsClient } from '@hemia/secrets';
import type { Category, Environment } from '@hemia/secrets';
import { SecretsService } from '@hemia/secrets/nestjs';
import secretsConfig from '../../config/secrets.config';

@Module({
  imports: [ConfigModule.forFeature(secretsConfig)],
  providers: [
    {
      provide: SecretsService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SecretsService | null => {
        // Do not construct a Vault client or require AppRole credentials in env mode.
        if (!config.get<boolean>('secrets.enabled')) return null;
        return new SecretsService(
          createSecretsClient({
            scope: {
              environment: config.getOrThrow<Environment>(
                'secrets.environment',
              ),
              category: config.getOrThrow<Category>('secrets.category'),
              owner: config.getOrThrow<string>('secrets.owner'),
              system: config.getOrThrow<string>('secrets.system'),
            },
            provider: {
              type: 'hashicorp-vault',
              options: {
                baseUrl: config.getOrThrow<string>('secrets.baseUrl'),
                roleId: config.getOrThrow<string>('secrets.roleId'),
                secretId: config.getOrThrow<string>('secrets.secretId'),
                authPath: config.getOrThrow<string>('secrets.authPath'),
                mountPrefix: config.getOrThrow<string>('secrets.mountPrefix'),
                timeoutMs: config.getOrThrow<number>('secrets.timeoutMs'),
              },
            },
            cache: {
              enabled: config.getOrThrow<boolean>('secrets.cacheEnabled'),
              ttlMs: config.getOrThrow<number>('secrets.cacheTtlMs'),
            },
          }),
        );
      },
    },
  ],
  exports: [SecretsService],
})
export class SecretsModule {}
