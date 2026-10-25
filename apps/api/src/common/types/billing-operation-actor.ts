import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request.type';
export type BillingOperationActor = {
  issuer: string;
  subject: string;
  identityReferenceId: string;
  traceId: string;
};
export function billingOperationActor(
  request: AuthenticatedRequest,
): BillingOperationActor {
  const identity = request.accessContext?.identity;
  if (
    !identity?.issuer ||
    !identity.subject_id ||
    !identity.identity_reference_id ||
    request.principal?.isMachine !== false
  )
    throw new UnauthorizedException('Verified operator required');
  return {
    issuer: identity.issuer,
    subject: identity.subject_id,
    identityReferenceId: identity.identity_reference_id,
    traceId: randomUUID(),
  };
}
