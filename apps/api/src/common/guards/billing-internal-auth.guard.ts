import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BillingInternalApiKeyGuard } from './billing-internal-api-key.guard';
import { SsoBearerGuard } from './sso-bearer.guard';

@Injectable()
export class BillingInternalAuthGuard implements CanActivate {
  constructor(
    private readonly ssoBearerGuard: SsoBearerGuard,
    private readonly apiKeyGuard: BillingInternalApiKeyGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.header('authorization');

    if (authorization?.startsWith('Bearer ')) {
      return this.ssoBearerGuard.canActivate(context);
    }

    const allowedByApiKey = this.apiKeyGuard.canActivate(context);

    request.principal = {
      sub: 'legacy-api-key',
      scopes: ['billing.*'],
      isMachine: true,
    };
    request.user = request.principal;

    return allowedByApiKey;
  }
}
