import type { BillingAuthorization } from '../../modules/auth/session/billing-console-permissions';
import type { AccessContext, AccessOrganizationContext } from '@hemia/auth';
import { Request } from 'express';
import type { BillingServiceAuthorization } from './billing-service-authorization.type';

export type AuthenticatedPrincipal = {
  issuer?: string;
  sub: string;
  scopes: string[];
  permissions?: string[];
  clientId?: string;
  organizationId?: string;
  email?: string;
  isMachine: boolean;
};

export type AuthenticatedRequest = Request & {
  billingServiceAuthorization?: BillingServiceAuthorization;
  billingAuthorization?: BillingAuthorization;
  billingOrganizationScope?: string[] | null;
  principal?: AuthenticatedPrincipal;
  user?: unknown;
  accessContext?: AccessContext;
  selectedAccessOrganization?: AccessOrganizationContext;
  ssoSubject?: string;
  ssoAuth?: {
    accessToken: string;
    cookie: string;
    authorization: string;
  };
};
