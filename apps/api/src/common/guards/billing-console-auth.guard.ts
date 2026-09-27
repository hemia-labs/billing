import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '@hemia/auth';
import { SsoAuthGuard } from '@hemia/auth/nestjs';
import { BillingConsoleSessionService } from '../../modules/auth/billing-console-session.service';
import { AuthenticatedRequest } from '../types/authenticated-request.type';

@Injectable()
export class BillingConsoleAuthGuard implements CanActivate {
  constructor(
    private readonly ssoAuthGuard: SsoAuthGuard,
    private readonly reflector: Reflector,
    private readonly consoleSession: BillingConsoleSessionService,
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

    if (!user?.sub) {
      throw new UnauthorizedException('Missing session');
    }

    const session = await this.consoleSession.resolve(request, {
      allowOrganizationSelection: false,
    });

    request.principal = {
      sub: user.internalUserId ?? user.sub,
      email: user.email || undefined,
      organizationId: session.organizationId,
      scopes: session.permissions,
      permissions: session.permissions,
      isMachine: false,
    };
    request.user = request.principal;

    return true;
  }
}
