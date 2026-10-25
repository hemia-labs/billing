import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { SsoBearerGuard } from '../../common/guards/sso-bearer.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';

/** Delegated administration: Console authorizes its operator before calling this API. */
@Injectable()
export class BillingIntegrationAdminGuard implements CanActivate {
  constructor(
    private readonly bearer: SsoBearerGuard,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.bearer.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      !request.principal?.isMachine ||
      !request.principal.clientId ||
      !required?.length ||
      !required.every((s) => request.principal!.scopes.includes(s))
    )
      throw new ForbiddenException(
        'Delegated integration administration scope required',
      );
    if (!isUUID(request.header('x-hemia-actor-subject')))
      throw new ForbiddenException(
        'Verified Console operator subject required',
      );
    return true;
  }
}
