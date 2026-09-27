import { webhookOrganizationSql } from '../../modules/webhooks/webhook-organization.sql';
import { DataSource } from 'typeorm';
import type { BillingResourceKind } from '../decorators/billing-resource.decorator';
import { permissionScope } from '../../modules/auth/billing-console-permissions';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthenticatedRequest } from '../types/authenticated-request.type';
import { hasAllPermissions } from './permissions.util';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal && !request.principal.isMachine) {
      if (!request.billingAuthorization || !requiredPermissions.length)
        throw new ForbiddenException('Missing explicit Billing authorization');
      let scope: string[] | null = null;
      for (const permission of requiredPermissions) {
        const next = permissionScope(request.billingAuthorization, permission);
        if (next !== null)
          scope =
            scope === null ? next : scope.filter((id) => next.includes(id));
      }
      if (scope?.length === 0)
        throw new ForbiddenException('No authorized customer');
      request.billingOrganizationScope = scope;
      const resource = this.reflector.getAllAndOverride<{
        kind: BillingResourceKind;
        parameter: string;
      }>('billing:resource', [context.getHandler(), context.getClass()]);
      if (resource && scope !== null) {
        const id = request.params[resource.parameter];
        if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
          throw new ForbiddenException('Resource scope unavailable');
        const sql =
          resource.kind === 'webhook_events'
            ? `SELECT ${webhookOrganizationSql('w')} AS organization_id FROM webhook_events w WHERE w.id=$1`
            : resource.kind === 'subscription_addons'
              ? 'SELECT s.organization_id FROM subscription_addons a JOIN subscriptions s ON s.id=a.subscription_id WHERE a.id=$1 AND a.deleted_at IS NULL AND s.deleted_at IS NULL'
              : `SELECT organization_id FROM ${resource.kind} WHERE id=$1`;
        const rows = await this.database.query<
          Array<{ organization_id: string | null }>
        >(sql, [id]);
        if (
          rows.length !== 1 ||
          !rows[0].organization_id ||
          !scope.includes(rows[0].organization_id)
        )
          throw new ForbiddenException('Resource outside authorized scope');
      }
      return true;
    }
    if (requiredPermissions.length === 0) return true;
    const grantedPermissions =
      request.principal?.permissions ?? request.principal?.scopes ?? [];

    if (!hasAllPermissions(grantedPermissions, requiredPermissions)) {
      throw new ForbiddenException('Missing required permission');
    }

    return true;
  }
}
