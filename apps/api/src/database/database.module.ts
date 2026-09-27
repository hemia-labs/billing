import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';
import { SecretsModule } from '../modules/secrets/secrets.module';
import { SecretsService } from '@hemia/secrets/nestjs';
import type { DataSourceOptions } from 'typeorm';
import databaseConfig from '../config/database.config';
import { isDatabaseSecret, type DatabaseSecret } from './types/database.types';

@Module({
  imports: [
    SecretsModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule.forFeature(databaseConfig), SecretsModule],
      inject: [ConfigService, SecretsService],
      useFactory: resolveDatabaseOptions,
    }),
  ],
})
export class DatabaseModule {}

export async function resolveDatabaseOptions(
  config: ConfigService,
  secrets: SecretsService | null,
): Promise<DataSourceOptions> {
  const options: DataSourceOptions = {
    type: 'postgres',
    host: config.get<string>('database.host'),
    port: config.get<number>('database.port'),
    username: config.get<string>('database.username'),
    password: config.get<string>('database.password'),
    database: config.get<string>('database.name'),
    logging: config.get<boolean>('database.logging'),
    extra: { options: '-c timezone=America/Mexico_City' },
    entities: [
      path.join(__dirname, '..', '**', '*.entity.ts'),
      path.join(__dirname, '..', '**', '*.entity.js'),
    ],
    synchronize: false,
  };

  const secret = config.get<boolean>('secrets.enabled', false)
    ? await secrets!.getRequired<DatabaseSecret>('database/postgres')
    : {
        db_host: options.host,
        db_port: options.port,
        db_username: options.username,
        db_password: options.password,
        db_database: options.database,
        db_logging: options.logging,
      };

  if (!isDatabaseSecret(secret)) {
    throw new Error(
      'Database configuration must contain valid db_host, db_port, db_username, db_password, db_database and db_logging',
    );
  }

  return {
    ...options,
    host: secret.db_host,
    port: secret.db_port,
    username: secret.db_username,
    password: secret.db_password,
    database: secret.db_database,
    logging: secret.db_logging,
  };
}
