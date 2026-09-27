import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { SsoCore, type SsoConfig } from '@hemia/auth';
import { SSO_CONFIG } from '@hemia/auth/nestjs';
import type { Request, Response } from 'express';

@Injectable()
export class AuthLogoutMiddleware implements NestMiddleware {
  constructor(
    private readonly sso: SsoCore,
    @Inject(SSO_CONFIG) private readonly config: SsoConfig,
  ) {}

  async use(req: Request, res: Response) {
    const cookie: unknown = req.cookies?.[this.config.cookieName];
    const sessionId = typeof cookie === 'string' ? cookie : undefined;
    const result = await this.sso.logout(sessionId);

    res.clearCookie(this.config.cookieName, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.config.cookieSecure,
    });
    res.clearCookie('billing_organization', {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.config.cookieSecure,
    });
    res.json(result);
  }
}
