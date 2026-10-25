import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Response } from 'express';
import type { SsoConfig } from '@hemia/auth';
import { SSO_CONFIG, SsoAuthGuard } from '@hemia/auth/nestjs';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request.type';
import { BillingConsoleSessionService } from './billing-console-session.service';

class SelectOrganizationDto {
  @IsUUID()
  organizationId: string;
}

@Controller('auth/organization')
@UseGuards(SsoAuthGuard)
export class BillingOrganizationController {
  constructor(
    private readonly sessions: BillingConsoleSessionService,
    @Inject(SSO_CONFIG) private readonly config: SsoConfig,
  ) {}

  @Post()
  async select(
    @Body() body: SelectOrganizationDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (request.get('origin') !== new URL(this.config.frontendUrl).origin) {
      throw new ForbiddenException('Invalid request origin');
    }
    request.cookies = {
      ...request.cookies,
      billing_organization: body.organizationId,
    };
    const session = await this.sessions.resolve(request);
    response.cookie('billing_organization', session.organizationId, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.config.sessionTtlSeconds * 1000,
    });
    return session;
  }
}
