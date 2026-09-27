import { BillingOrganizationController } from './billing-organization.controller';
import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecretsService } from '@hemia/secrets/nestjs';
import { SecretsModule } from '../secrets/secrets.module';
import { resolveSsoConfig } from './sso-vault.config';
import { SESSION_STORE, SsoModule } from '@hemia/auth/nestjs';
import { AuthSessionMiddleware } from './auth-session.middleware';
import { BillingConsoleSessionService } from './billing-console-session.service';
import { AuthLogoutMiddleware } from './auth-logout.middleware';
import { RedisModule } from './redis.module';
import { RedisSessionStore } from './redis-session-store';

@Module({
  imports: [
    RedisModule,
    SsoModule.forRootAsync({
      global: false,
      imports: [ConfigModule, RedisModule, SecretsModule],
      inject: [ConfigService, SecretsService],
      store: { provide: SESSION_STORE, useExisting: RedisSessionStore },
      useFactoryConfig: resolveSsoConfig,
    }),
  ],
  controllers: [BillingOrganizationController],
  providers: [
    AuthLogoutMiddleware,
    AuthSessionMiddleware,
    BillingConsoleSessionService,
  ],
  exports: [SsoModule, BillingConsoleSessionService],
})
export class AuthModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthSessionMiddleware)
      .forRoutes({ method: RequestMethod.GET, path: 'auth/session' });
    consumer
      .apply(AuthLogoutMiddleware)
      .forRoutes({ method: RequestMethod.POST, path: 'auth/logout' });
  }
}
