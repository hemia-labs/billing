import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { Session, SsoConfig } from '@hemia/auth';
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
    const key = sessionId ? `sso:session:${sessionId}` : undefined;
    const session = key ? await this.store.get<Session>(key) : null;
    const revoked = await this.revoke(session);

    if (key) await this.store.delete(key);

    res.clearCookie(this.config.cookieName, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.config.cookieSecure,
    });
    res.json({
      revoked,
      logoutUrl: this.config.logoutUrl ?? this.config.frontendUrl,
    });
  }

  private async revoke(session: Session | null): Promise<boolean> {
    if (!session?.accessToken) return false;

    const access = await this.revokeToken(session.accessToken, 'access_token');
    const refresh = session.refreshToken
      ? await this.revokeToken(session.refreshToken, 'refresh_token')
      : false;

    return access || refresh;
  }

  private async revokeToken(token: string, hint: string): Promise<boolean> {
    if (!this.config.revocationUrl) return false;

    try {
      const response = await fetch(this.config.revocationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          token_type_hint: hint,
          client_id: this.config.clientId,
          ...(this.config.clientSecret && {
            client_secret: this.config.clientSecret,
          }),
        }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
