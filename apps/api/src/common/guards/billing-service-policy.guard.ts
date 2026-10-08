import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import {
  BILLING_SERVICE_ACCESS,
  BillingServiceAccessRule,
} from '../decorators/billing-service-access.decorator';
import {
  BillingResourceContextRepository,
  type BillingServiceResource,
} from '../repositories/billing-resource-context.repository';
import { BillingServicePolicyService } from '../services/billing-service-policy.service';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';
import {
  billingServiceAuthorization,
  BillingServiceAuthorization,
} from '../types/billing-service-authorization.type';

@Injectable()
export class BillingServicePolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resources: BillingResourceContextRepository,
    private readonly policy: BillingServicePolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const body = (request.body ?? {}) as Record<string, unknown>;
    const authorization = billingServiceAuthorization(request);
    const rule = this.reflector.getAllAndOverride<BillingServiceAccessRule>(
      BILLING_SERVICE_ACCESS,
      [context.getHandler(), context.getClass()],
    );
    if (!rule)
      throw new ForbiddenException('Service resource policy is required');
    if (rule === 'catalog') return true; // Controllers pass the product filter to the query.
    if (rule === 'catalog-target') {
      await this.assertCatalogTarget(authorization, body);
    } else if (rule === 'invoice-list') {
      const organization = request.query.organization_id;
      if (organization !== undefined)
        this.policy.assertOrganization(
          authorization,
          this.string(organization),
        );
      if (request.query.payment_id !== undefined)
        await this.assertResource(
          authorization,
          'payments',
          this.string(request.query.payment_id),
        );
    } else if (typeof rule === 'object' && 'resource' in rule) {
      const input = (request[rule.source ?? 'params'] ?? {}) as Record<
        string,
        unknown
      >;
      await this.assertResource(
        authorization,
        rule.resource,
        this.string(input[rule.parameter ?? 'id']),
      );
      if (rule.resource === 'products' && body.code !== undefined)
        this.policy.assertProduct(authorization, this.string(body.code));
      if (
        (rule.resource === 'plans' || rule.resource === 'addons') &&
        (body.productId !== undefined || body.productCode !== undefined)
      )
        await this.assertCatalogTarget(authorization, body);
    } else if (typeof rule === 'object' && 'product' in rule) {
      const input = (request[rule.source] ?? {}) as Record<string, unknown>;
      this.policy.assertProduct(
        authorization,
        this.string(input[rule.product]),
      );
      if (rule.organization)
        this.policy.assertOrganization(
          authorization,
          this.string(
            input[rule.organization] ?? request.principal?.organizationId,
          ),
        );
    } else {
      throw new ForbiddenException('Unknown service resource policy');
    }
    return true;
  }

  private string(value: unknown): string {
    if (typeof value !== 'string' || !value.trim())
      throw new BadRequestException('Service resource context is required');
    return value;
  }

  private async assertCatalogTarget(
    authorization: BillingServiceAuthorization,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (body.productId !== undefined)
      await this.assertResource(
        authorization,
        'products',
        this.string(body.productId),
      );
    if (body.productCode !== undefined)
      this.policy.assertProduct(authorization, this.string(body.productCode));
    if (body.productId === undefined && body.productCode === undefined)
      throw new BadRequestException('Product context is required');
  }

  private async assertResource(
    authorization: BillingServiceAuthorization,
    resource: BillingServiceResource,
    id: string,
  ): Promise<void> {
    if (!isUUID(id))
      throw new BadRequestException('Resource id must be a UUID');
    const stored = await this.resources.findContext(resource, id);
    if (!stored) throw new NotFoundException('Billing resource not found');
    try {
      if (resource === 'checkout_sessions') {
        await this.policy.assertCheckout(authorization, {
          productCode: stored.productCode ?? '',
          organizationId: stored.organizationId ?? '',
          metadata: stored.metadata,
        });
      } else {
        if (stored.productCode)
          this.policy.assertProduct(authorization, stored.productCode);
        else if (!authorization.policy.products.includes('*'))
          throw new ForbiddenException('Resource product scope unavailable');
        if (stored.organizationId)
          this.policy.assertOrganization(authorization, stored.organizationId);
      }
    } catch (error) {
      if (error instanceof ForbiddenException)
        throw new NotFoundException('Billing resource not found');
      throw error;
    }
  }
}
