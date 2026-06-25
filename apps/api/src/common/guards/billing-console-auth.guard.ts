import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../types/authenticated-request.type';
import { SsoBearerGuard } from './sso-bearer.guard';

@Injectable()
export class BillingConsoleAuthGuard implements CanActivate {
  constructor(
    private readonly ssoBearerGuard: SsoBearerGuard,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipAuth = this.reflector.getAllAndOverride<boolean>(
      'billing:console:skip-auth',
      [context.getHandler(), context.getClass()],
    );
    if (skipAuth) return true;

    await this.ssoBearerGuard.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.principal || request.principal.isMachine) {
      throw new UnauthorizedException('Machine credentials cannot access console');
    }

    return true;
  }
}
