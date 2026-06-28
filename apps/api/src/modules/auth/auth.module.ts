import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { SsoConfig } from '@hemia/auth';
import { SESSION_STORE, SsoModule } from '@hemia/auth/nestjs';
import { AuthLogoutMiddleware } from './auth-logout.middleware';
import { RedisModule } from './redis.module';
import { RedisSessionStore } from './redis-session-store';

@Module({
  imports: [
    RedisModule,
    SsoModule.forRootAsync({
      global: false,
      imports: [ConfigModule, RedisModule],
      inject: [ConfigService],
      store: { provide: SESSION_STORE, useExisting: RedisSessionStore },
      useFactoryConfig: (config: ConfigService): SsoConfig =>
        config.getOrThrow<SsoConfig>('sso'),
    }),
  ],
  providers: [AuthLogoutMiddleware],
  exports: [SsoModule],
})
export class AuthModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthLogoutMiddleware).forRoutes({
      method: RequestMethod.POST,
      path: 'auth/logout',
    });
  }
}
