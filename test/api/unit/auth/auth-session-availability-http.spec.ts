import type { Server } from 'node:http';
import 'reflect-metadata';
import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { RequestHandler } from 'express';
import { AccessContextError, SsoCore, UnauthorizedError } from '@hemia/auth';
import { SSO_CONFIG, SsoExceptionFilter } from '@hemia/auth/nestjs';
import { AuthSessionMiddleware } from '../../../../apps/api/src/modules/auth/session/auth-session.middleware';
import { BillingConsoleSessionService } from '../../../../apps/api/src/modules/auth/session/billing-console-session.service';

const getSession = jest.fn();
const consoleSession = { resolve: jest.fn() };
@Controller('auth')
class SessionController {
  @Get('session') session() {
    throw new Error('The middleware must handle the session route');
  }
}
@Module({
  controllers: [SessionController],
  providers: [
    AuthSessionMiddleware,
    { provide: SsoCore, useValue: { getSession } },
    { provide: SSO_CONFIG, useValue: { cookieName: 'billing_session' } },
    { provide: BillingConsoleSessionService, useValue: consoleSession },
  ],
})
class SessionBoundaryModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthSessionMiddleware).forRoutes(SessionController);
  }
}
describe('auth/session dependency availability HTTP contract', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [SessionBoundaryModule],
    }).compile();
    app = module.createNestApplication();
    app.use((cookieParser as () => RequestHandler)());
    app.useGlobalFilters(new SsoExceptionFilter());
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app.close();
  });
  it.each([['Missing session'], ['Invalid session'], ['Session expired']])(
    'keeps SDK session rejection as401: %s',
    async (message) => {
      getSession.mockRejectedValue(new UnauthorizedError(message));
      const response = await request(app.getHttpServer() as Server)
        .get('/auth/session')
        .expect(401);
      expect(response.body).toMatchObject({ message });
      expect(consoleSession.resolve).not.toHaveBeenCalled();
    },
  );
  it.each([
    [503, 'Access authorization unavailable'],
    [403, 'Billing access is not enabled'],
    [401, 'Session no longer available'],
    [409, 'Authorization changed; retry the request'],
  ])(
    'preserves Access status %i during session refresh and redacts details',
    async (status, message) => {
      getSession.mockRejectedValue(
        new AccessContextError(
          status,
          'internal upstream details access-token=private refresh-token=private',
        ),
      );
      const response = await request(app.getHttpServer() as Server)
        .get('/auth/session')
        .set('Cookie', 'billing_session=existing-session')
        .expect(status);
      expect(getSession).toHaveBeenCalledWith('existing-session');
      expect(response.body).toMatchObject({ message });
      expect(JSON.stringify(response.body)).not.toContain('private');
      expect(JSON.stringify(response.body)).not.toContain('internal upstream');
      expect(consoleSession.resolve).not.toHaveBeenCalled();
    },
  );
});
