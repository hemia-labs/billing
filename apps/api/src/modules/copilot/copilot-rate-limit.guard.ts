import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { REDIS } from '../auth/redis-session-store';

@Injectable()
export class CopilotRateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal?.sub) throw new UnauthorizedException();
    const actor = createHash('sha256')
      .update(
        `${request.principal.organizationId ?? ''}:${request.principal.sub}`,
      )
      .digest('hex');
    let count: unknown;
    try {
      count = await this.redis.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end; return count",
        1,
        `billing:copilot:rate:${actor}`,
      );
    } catch {
      throw new ServiceUnavailableException(
        'MIA no está disponible temporalmente.',
      );
    }
    if (typeof count !== 'number')
      throw new ServiceUnavailableException(
        'MIA no está disponible temporalmente.',
      );
    if (count > 10) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('Retry-After', '60');
      throw new HttpException(
        'Espera un minuto antes de volver a intentarlo.',
        429,
      );
    }
    return true;
  }
}
