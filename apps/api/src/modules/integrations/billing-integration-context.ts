import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../common/types/authenticated-request.type';

export const resolveIntegrationOrganizationId = (
  principal: AuthenticatedPrincipal | undefined,
  requestedOrganizationId?: string,
): string => {
  if (principal?.organizationId) {
    if (
      requestedOrganizationId &&
      requestedOrganizationId !== principal.organizationId
    ) {
      throw new ForbiddenException('Organization is outside integration context');
    }

    return principal.organizationId;
  }

  if (!requestedOrganizationId) {
    throw new BadRequestException('organization_id is required');
  }

  return requestedOrganizationId;
};

export const resolveIntegrationUserId = (
  principal: AuthenticatedPrincipal | undefined,
  requestedUserId?: string,
): string => requestedUserId ?? principal?.sub ?? '';
