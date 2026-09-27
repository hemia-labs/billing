import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecretsService } from '@hemia/secrets/nestjs';
import IORedis, { type RedisOptions } from 'ioredis';
import { SecretsModule } from '../secrets/secrets.module';
import { REDIS, RedisSessionStore } from './redis-session-store';
import { isRedisSecret, type RedisSecret } from './types/redis.types';

@Module({
  imports: [ConfigModule, SecretsModule],
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService, SecretsService],
      useFactory: createRedis,
    },
    RedisSessionStore,
  ],
  exports: [REDIS, RedisSessionStore],
})
export class RedisModule {}

export async function createRedis(
  config: ConfigService,
  secrets: SecretsService | null,
) {
  const redis = config.getOrThrow<RedisOptions>('redis');

  const secret = config.get<boolean>('secrets.enabled', false)
    ? await secrets!.getRequired<RedisSecret>('cache/redis')
    : {
        redis_host: redis.host,
        redis_port: redis.port,
        redis_password: redis.password ?? '',
        redis_db: redis.db,
      };
  if (!isRedisSecret(secret)) {
    throw new Error(
      'Redis configuration must contain valid redis_db, redis_host, redis_password and redis_port',
    );
  }
  if (
    config.get<string>('app.nodeEnv') === 'production' &&
    !secret.redis_password.trim()
  ) {
    throw new Error('Redis password is required in production');
  }

  return new IORedis({
    lazyConnect: true,
    host: secret.redis_host,
    port: secret.redis_port,
    password: secret.redis_password || undefined,
    db: secret.redis_db,
  });
}
