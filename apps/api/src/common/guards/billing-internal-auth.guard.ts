import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../types/authenticated-request.type';
import { SsoBearerGuard } from './sso-bearer.guard';
import { BillingServicePolicyService } from '../services/billing-service-policy.service';

@Injectable()
export class BillingInternalAuthGuard implements CanActivate {
  constructor(
    private readonly ssoBearerGuard: SsoBearerGuard,
    private readonly servicePolicy: BillingServicePolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header('authorization');

    if (authorization?.startsWith('Bearer ')) {
      await this.ssoBearerGuard.canActivate(context);

      const authenticatedRequest = context
        .switchToHttp()
        .getRequest<AuthenticatedRequest>();

      if (!authenticatedRequest.principal?.isMachine) {
        throw new UnauthorizedException(
          'User credentials cannot access integrations',
        );
      }

      authenticatedRequest.billingServiceAuthorization =
        await this.servicePolicy.resolvePrincipal(
          authenticatedRequest.principal,
        );
      return true;
    }

    throw new UnauthorizedException('Service bearer token required');
  }
}
