import { Request } from 'express';

export type AuthenticatedPrincipal = {
  sub: string;
  scopes: string[];
  clientId?: string;
  organizationId?: string;
  email?: string;
  isMachine: boolean;
};

export type AuthenticatedRequest = Request & {
  principal?: AuthenticatedPrincipal;
  user?: AuthenticatedPrincipal;
};
