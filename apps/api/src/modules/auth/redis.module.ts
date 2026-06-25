import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS, RedisSessionStore } from './redis-session-store';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.getOrThrow<string>('redis.host'),
          password: config.get<string>('redis.password'),
          db: config.getOrThrow<number>('redis.db'),
          lazyConnect: true,
        }),
    },
    RedisSessionStore,
  ],
  exports: [RedisSessionStore],
})
export class RedisModule {}
