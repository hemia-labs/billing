import {
  HttpException,
  Injectable,
  NestMiddleware,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SSO_CONFIG } from '@hemia/auth/nestjs';
import { AccessContextError, SsoCore, type SsoConfig } from '@hemia/auth';
import { Inject } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { BillingConsoleSessionService } from './billing-console-session.service';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request.type';

@Injectable()
export class AuthSessionMiddleware implements NestMiddleware {
  constructor(
    private readonly sso: SsoCore,
    private readonly consoleSession: BillingConsoleSessionService,
    @Inject(SSO_CONFIG) private readonly config: SsoConfig,
  ) {}

  async use(req: Request, res: Response, _next: NextFunction): Promise<void> {
    void _next;
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const sessionId = cookies?.[this.config.cookieName];
    let session: Awaited<ReturnType<SsoCore['getSession']>>;
    try {
      session = await this.sso.getSession(
        typeof sessionId === 'string' ? sessionId : undefined,
      );
    } catch (error) {
      // SDK refresh also resolves Access; its exception filter only handles SSO errors.
      if (error instanceof AccessContextError) {
        if (error.status === 401)
          throw new HttpException('Session no longer available', 401);
        if (error.status === 403)
          throw new HttpException('Billing access is not enabled', 403);
        if (error.status === 409)
          throw new HttpException(
            'Authorization changed; retry the request',
            409,
          );
        throw new ServiceUnavailableException(
          'Access authorization unavailable',
        );
      }
      throw error;
    }

    const request = req as AuthenticatedRequest;

    request.user = session.user;
    request.accessContext = session.accessContext;
    request.ssoAuth = {
      accessToken: session.accessToken,
      cookie: session.id,
      authorization: `Bearer ${session.accessToken}`,
    };

    res.json(
      await this.consoleSession.resolve(request, {
        allowOrganizationSelection: true,
      }),
    );
  }
}
