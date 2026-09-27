import type { BillingAuthorization } from '../../modules/auth/billing-console-permissions';
import type { AccessContext, AccessOrganizationContext } from '@hemia/auth';
import { Request } from 'express';

export type AuthenticatedPrincipal = {
  sub: string;
  scopes: string[];
  permissions?: string[];
  clientId?: string;
  organizationId?: string;
  email?: string;
  isMachine: boolean;
};

export type AuthenticatedRequest = Request & {
  billingAuthorization?: BillingAuthorization;
  billingOrganizationScope?: string[] | null;
  principal?: AuthenticatedPrincipal;
  user?: unknown;
  accessContext?: AccessContext;
  selectedAccessOrganization?: AccessOrganizationContext;
  ssoAuth?: {
    accessToken: string;
    cookie: string;
    authorization: string;
  };
};
