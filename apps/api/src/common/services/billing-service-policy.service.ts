import { EntityManager } from 'typeorm';
import { BillingServiceClientRegistryService } from './billing-service-client-registry.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedPrincipal } from '../types/authenticated-request.type';
import type {
  BillingServiceActor,
  BillingServiceAuthorization,
} from '../types/billing-service-authorization.type';
import {
  isLocalCheckoutReturnUrl,
  parseCheckoutReturnUrl,
} from '../utils/checkout-return-url';

type CheckoutContext = {
  productCode: string;
  organizationId: string;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class BillingServicePolicyService {
  constructor(
    private readonly config: ConfigService,
    private readonly registry: BillingServiceClientRegistryService,
  ) {}

  async resolvePrincipal(
    principal?: AuthenticatedPrincipal,
  ): Promise<BillingServiceAuthorization> {
    if (!principal?.isMachine || !principal.clientId || !principal.issuer)
      throw new ForbiddenException('Verified service identity required');
    return this.resolve({
      issuer: principal.issuer,
      clientId: principal.clientId,
    });
  }

  async resolve(
    actor: BillingServiceActor,
    manager?: EntityManager,
  ): Promise<BillingServiceAuthorization> {
    const issuer =
      this.config.get<string>('auth.requiredIssuer') ??
      this.config.get<string>('auth.issuerUrl');
    if (
      !issuer ||
      !actor ||
      !actor.issuer ||
      !actor.clientId ||
      actor.issuer !== issuer
    )
      throw new ForbiddenException('Service client is not authorized');
    const policy = await this.registry.findPolicy(actor.clientId, manager);
    if (!policy)
      throw new ForbiddenException('Service client is not authorized');
    if (!policy.enabled)
      throw new ForbiddenException('Service client is disabled');
    return { ...actor, policy };
  }

  assertProduct(
    authorization: BillingServiceAuthorization,
    productCode: string,
  ): void {
    if (
      !productCode ||
      (!authorization.policy.products.includes('*') &&
        !authorization.policy.products.includes(productCode))
    )
      throw new ForbiddenException('Product is outside service scope');
  }

  assertOrganization(
    authorization: BillingServiceAuthorization,
    organizationId: string,
  ): void {
    if (
      !organizationId ||
      (authorization.policy.organizationScope === 'organizations' &&
        !authorization.policy.organizationIds.some(
          (id) => id.toLowerCase() === organizationId.toLowerCase(),
        ))
    )
      throw new ForbiddenException('Organization is outside service scope');
  }

  async assertContext(
    actor: BillingServiceActor,
    productCode: string,
    organizationId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const authorization = await this.resolve(actor, manager);
    this.assertProduct(authorization, productCode);
    this.assertOrganization(authorization, organizationId);
  }

  async assertCheckout(
    actor: BillingServiceActor,
    checkout: CheckoutContext,
    manager?: EntityManager,
  ): Promise<void> {
    const authorization = await this.resolve(actor, manager);
    try {
      this.assertProduct(authorization, checkout.productCode);
      this.assertOrganization(authorization, checkout.organizationId);
      if (
        !authorization.policy.allowSharedCheckouts &&
        (checkout.metadata?.createdByIssuer !== actor.issuer ||
          checkout.metadata?.createdByClientId !== actor.clientId)
      )
        throw new ForbiddenException('Checkout is outside service ownership');
    } catch (error) {
      if (error instanceof ForbiddenException)
        throw new NotFoundException('Billing checkout session not found');
      throw error;
    }
  }

  async assertReturnUrls(
    actor: BillingServiceActor,
    successUrl: string,
    cancelUrl: string,
    manager?: EntityManager,
  ): Promise<void> {
    const { policy } = await this.resolve(actor, manager);
    const nodeEnv = this.config.get<string>('app.nodeEnv');
    for (const value of [successUrl, cancelUrl]) {
      const url = parseCheckoutReturnUrl(value);
      if (
        !url ||
        (url.protocol !== 'https:' &&
          !(
            (nodeEnv === 'development' || nodeEnv === 'test') &&
            isLocalCheckoutReturnUrl(url)
          ))
      )
        throw new BadRequestException(
          'Return URLs must use HTTPS; HTTP loopback is allowed only in development or test',
        );
      if (!policy.allowedReturnOrigins.includes(url.origin))
        throw new ForbiddenException(
          'Return URL origin is outside service scope',
        );
    }
  }
}
