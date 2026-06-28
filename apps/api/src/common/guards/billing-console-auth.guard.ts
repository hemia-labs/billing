import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '@hemia/auth';
import { SsoAuthGuard } from '@hemia/auth/nestjs';
import { AuthenticatedRequest } from '../types/authenticated-request.type';

@Injectable()
export class BillingConsoleAuthGuard implements CanActivate {
  constructor(
    private readonly ssoAuthGuard: SsoAuthGuard,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipAuth = this.reflector.getAllAndOverride<boolean>(
      'billing:console:skip-auth',
      [context.getHandler(), context.getClass()],
    );
    if (skipAuth) return true;

    await this.ssoAuthGuard.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user as unknown as AuthenticatedUser | undefined;

    if (!user?.ssoUserId) {
      throw new UnauthorizedException('Missing session');
    }

    request.principal = {
      sub: user.internalUserId ?? user.ssoUserId,
      email: user.email || undefined,
      organizationId: user.organizationId || undefined,
      scopes: user.permissions,
      isMachine: false,
    };
    request.user = request.principal;

    return true;
  }
}
