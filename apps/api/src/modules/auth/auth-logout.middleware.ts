import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { SsoConfig } from '@hemia/auth';
import { SSO_CONFIG } from '@hemia/auth/nestjs';
import type { NextFunction, Request, Response } from 'express';
import { RedisSessionStore } from './redis-session-store';

@Injectable()
export class AuthLogoutMiddleware implements NestMiddleware {
  constructor(
    private readonly store: RedisSessionStore,
    @Inject(SSO_CONFIG) private readonly config: SsoConfig,
  ) {}

  async use(req: Request, res: Response, _next: NextFunction) {
    const sessionId = req.cookies?.[this.config.cookieName];
    if (sessionId) await this.store.delete(`sso:session:${sessionId}`);
    res.clearCookie(this.config.cookieName, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.config.cookieSecure,
    });
    res.json({ logoutUrl: this.config.logoutUrl ?? this.config.frontendUrl });
  }
}
