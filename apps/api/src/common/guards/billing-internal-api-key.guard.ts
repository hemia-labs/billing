import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

@Injectable()
export class BillingInternalApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const configuredApiKey = this.config.get<string>(
      'app.billingInternalApiKey',
    );
    const legacyApiKeyEnabled =
      this.config.get<boolean>('auth.legacyApiKeyEnabled') ?? false;
    const providedApiKey = request.header('x-billing-internal-api-key');

    if (!legacyApiKeyEnabled) {
      throw new UnauthorizedException('Invalid billing internal API key');
    }

    if (
      !configuredApiKey ||
      !providedApiKey ||
      !this.matches(configuredApiKey, providedApiKey)
    ) {
      throw new UnauthorizedException('Invalid billing internal API key');
    }

    return true;
  }

  private matches(configuredApiKey: string, providedApiKey: string): boolean {
    const configured = Buffer.from(configuredApiKey);
    const provided = Buffer.from(providedApiKey);

    return (
      configured.length === provided.length &&
      timingSafeEqual(configured, provided)
    );
  }
}
