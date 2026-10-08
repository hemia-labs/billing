import { UnauthorizedException } from '@nestjs/common';
import type { BillingServiceClientPolicy } from '../../config/billing-service-clients';
import type { AuthenticatedRequest } from './authenticated-request.type';

export type BillingServiceActor = { issuer: string; clientId: string };
export type BillingServiceAuthorization = BillingServiceActor & {
  policy: BillingServiceClientPolicy;
};

export function billingServiceAuthorization(
  request: AuthenticatedRequest,
): BillingServiceAuthorization {
  if (!request.billingServiceAuthorization)
    throw new UnauthorizedException('Verified service authorization required');
  return request.billingServiceAuthorization;
}

export function billingServiceActor(
  request: AuthenticatedRequest,
): BillingServiceActor {
  const { issuer, clientId } = billingServiceAuthorization(request);
  return { issuer, clientId };
}
