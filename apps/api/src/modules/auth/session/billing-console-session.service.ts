import type { AuthorizationMode } from '../../../config/authorization.config';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SystemContextCache,
  type AccessOrganizationContext,
} from '@hemia/auth';
import { RedisSessionStore } from '../redis/redis-session-store';
import { AccessClient } from '@hemia/auth/nestjs';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request.type';
import {
  validateBillingContext,
  permissionsForAuthorization,
} from './billing-console-permissions';

export type BillingConsoleSession = {
  authenticated: true;
  user: {
    ssoUserId: string;
    email: string;
    name: string;
  };
  organizationId: string;
  permissions: string[];
};

export type BillingOrganizationSelectionSession = {
  authenticated: true;
  user: BillingConsoleSession['user'];
  requiresOrganizationSelection: true;
  organizations: {
    organizationId: string;
    code: string;
    name: string;
  }[];
  permissions: [];
};

@Injectable()
export class BillingConsoleSessionService {
  private readonly contexts: SystemContextCache;
  constructor(
    private readonly accessClient: AccessClient,
    private readonly config: ConfigService,
    store: RedisSessionStore,
  ) {
    this.contexts = new SystemContextCache(store);
  }

  async resolve(
    request: AuthenticatedRequest,
    options: { allowOrganizationSelection: true },
  ): Promise<BillingConsoleSession | BillingOrganizationSelectionSession>;
  async resolve(
    request: AuthenticatedRequest,
    options?: { allowOrganizationSelection?: false },
  ): Promise<BillingConsoleSession>;
  async resolve(
    request: AuthenticatedRequest,
    options: { allowOrganizationSelection?: boolean } = {},
  ): Promise<BillingConsoleSession | BillingOrganizationSelectionSession> {
    const user = this.sessionUser(request);
    const mode =
      this.config.get<AuthorizationMode>('authorization.mode') ?? 'roles';
    const organization = this.resolveOrganization(request, options);

    if ('requiresOrganizationSelection' in organization) {
      return { authenticated: true, user, ...organization };
    }

    let claims: Record<string, unknown>;
    try {
      claims = await this.contexts.resolve(
        {
          sessionId: request.ssoAuth?.cookie ?? '',
          issuer: this.config.getOrThrow<string>('sso.issuer'),
          subject: user.ssoUserId,
          organizationId: organization.organization_id,
          membershipId: organization.membership_id,
          product: `billing:${mode}`,
          audience: 'billing-api',
        },
        !['GET', 'HEAD'].includes(request.method),
        async () => {
          const accessToken = await this.accessClient.exchangeUserToken(
            request.ssoAuth?.accessToken ?? '',
          );
          const fresh = await this.accessClient.resolveSystemContext(
            accessToken,
            {
              organization_id: organization.organization_id,
              product_code: 'billing',
              audience: 'billing-api',
            },
          );
          validateBillingContext(
            fresh,
            {
              subject: user.ssoUserId,
              issuer: this.config.getOrThrow<string>('sso.issuer'),
              identityReferenceId:
                request.accessContext!.identity.identity_reference_id,
              organizationId: organization.organization_id,
              membershipId: organization.membership_id,
            },
            mode,
          );
          return fresh;
        },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (
        error instanceof Error &&
        error.name === 'AccessContextError' &&
        'status' in error &&
        typeof error.status === 'number' &&
        [401, 403, 409, 503].includes(error.status)
      )
        throw new HttpException(error.message, error.status);
      throw new ServiceUnavailableException('Access authorization unavailable');
    }
    const authorization = validateBillingContext(
      claims,
      {
        subject: user.ssoUserId,
        issuer: this.config.getOrThrow<string>('sso.issuer'),
        identityReferenceId:
          request.accessContext!.identity.identity_reference_id,
        organizationId: organization.organization_id,
        membershipId: organization.membership_id,
      },
      mode,
    );
    request.billingAuthorization = authorization;
    const permissions = permissionsForAuthorization(authorization);

    request.selectedAccessOrganization = organization;

    return {
      authenticated: true,
      user,
      organizationId: organization.organization_id,
      permissions,
    };
  }

  private resolveOrganization(
    request: AuthenticatedRequest,
    options: { allowOrganizationSelection?: boolean },
  ):
    | AccessOrganizationContext
    | Omit<BillingOrganizationSelectionSession, 'authenticated' | 'user'> {
    const organizations =
      request.accessContext?.organizations.filter((organization) =>
        this.isAllowedOrganization(organization),
      ) ?? [];

    if (organizations.length === 0) {
      throw new ForbiddenException('Billing access is not enabled');
    }

    const selectedId: unknown = request.cookies?.billing_organization;
    if (selectedId) {
      const selected = organizations.find(
        (item) => item.organization_id === selectedId,
      );
      if (selected) return selected;
      // A stale selection must not silently switch the operator's context.
      if (!options.allowOrganizationSelection) {
        throw new ConflictException(
          'Organization selection is no longer available',
        );
      }
    }

    if (organizations.length > 1 || selectedId) {
      if (options.allowOrganizationSelection) {
        return {
          requiresOrganizationSelection: true,
          organizations: organizations.map((organization) => ({
            organizationId: organization.organization_id,
            code: organization.organization_code,
            name: organization.organization_name,
          })),
          permissions: [],
        };
      }

      throw new ConflictException('Multiple organizations available');
    }

    return organizations[0];
  }

  private isAllowedOrganization(
    organization: AccessOrganizationContext,
  ): boolean {
    return (
      organization.organization_status === 'active' &&
      organization.membership_status === 'active' &&
      this.isProductEnabled(organization)
    );
  }

  private isProductEnabled(organization: AccessOrganizationContext): boolean {
    return hasEnabledProduct(organization.product, this.productCode());
  }

  private productCode(): string {
    return this.config.get<string>('sso.productCode') ?? 'billing';
  }

  private sessionUser(
    request: AuthenticatedRequest,
  ): BillingConsoleSession['user'] {
    const user = request.user as {
      sub?: string;
      email?: string;
      name?: string;
    };

    return {
      ssoUserId: user.sub ?? '',
      email: user.email ?? '',
      name: user.name ?? '',
    };
  }
}

const hasEnabledProduct = (value: unknown, productCode: string): boolean => {
  if (!value || typeof value !== 'object') return false;

  if (Array.isArray(value)) return false;
  const product = value as Record<string, unknown>;
  return (
    product.code === productCode &&
    product.status === 'enabled' &&
    product.disabled !== true
  );
};
