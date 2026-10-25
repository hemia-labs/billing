import { Injectable, NestMiddleware } from '@nestjs/common';
import { SSO_CONFIG } from '@hemia/auth/nestjs';
import { SsoCore, type SsoConfig } from '@hemia/auth';
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
    const session = await this.sso.getSession(
      typeof sessionId === 'string' ? sessionId : undefined,
    );

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
