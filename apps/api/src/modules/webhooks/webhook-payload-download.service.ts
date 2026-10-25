import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { BillingAuditService } from '../audit';
import { BillingWebhookEventEntity } from '../billing-shared';
import { DownloadWebhookPayloadDto } from './dtos/download-webhook-payload.dto';
import { webhookOrganizationSql } from './webhook-organization.sql';

const PURPOSE = 'webhook_payload_download';

@Injectable()
export class WebhookPayloadDownloadService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(BillingWebhookEventEntity)
    private readonly events: Repository<BillingWebhookEventEntity>,
    private readonly audit: BillingAuditService,
  ) {}

  async download(
    id: string,
    dto: DownloadWebhookPayloadDto,
    request: AuthenticatedRequest,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const subject = request.ssoSubject;
    const accessToken = request.ssoAuth?.accessToken;
    if (
      !request.principal ||
      request.principal.isMachine ||
      !subject ||
      !accessToken ||
      !request.ssoAuth?.cookie ||
      request.billingOrganizationScope === undefined
    ) {
      throw new UnauthorizedException('Se requiere una sesión de usuario.');
    }
    await this.reauthenticate(accessToken, subject, dto.password);
    const event = await this.events.findOne({ where: { id } });
    if (!event) throw new NotFoundException('No se encontró el webhook.');
    const [owner] = await this.events.query<
      Array<{ organization_id: string | null }>
    >(
      `SELECT ${webhookOrganizationSql('w')} AS organization_id FROM webhook_events w WHERE w.id=$1`,
      [id],
    );
    if (
      request.billingOrganizationScope !== null &&
      (!owner?.organization_id ||
        !request.billingOrganizationScope.includes(owner.organization_id))
    ) {
      throw new ForbiddenException('Webhook fuera del alcance autorizado.');
    }
    const buffer = Buffer.from(
      JSON.stringify(event.payloadJson, null, 2),
      'utf8',
    );
    await this.audit.record({
      actorUserId: request.principal.sub,
      organizationId: owner?.organization_id ?? null,
      action: 'billing.webhook.payload_download',
      resourceType: 'billing_webhook_event',
      resourceId: event.id,
      provider: event.provider,
      metadata: { downloadReason: dto.reason },
    });
    return { buffer, filename: `webhook-${event.id}.json` };
  }

  private async reauthenticate(
    accessToken: string,
    subject: string,
    password: string,
  ): Promise<void> {
    let response: Response;
    try {
      const endpoint = new URL(
        '/api/v1/auth/reauthenticate',
        this.config.getOrThrow<string>('sso.issuer'),
      );
      const localDevelopment =
        endpoint.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) &&
        ['development', 'test'].includes(
          this.config.getOrThrow<string>('app.nodeEnv'),
        );
      if (
        (endpoint.protocol !== 'https:' && !localDevelopment) ||
        endpoint.username ||
        endpoint.password
      ) {
        throw new Error('Identity password confirmation requires HTTPS');
      }
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password, purpose: PURPOSE }),
      });
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo confirmar la identidad. Intenta de nuevo.',
      );
    }
    if (response.status === 429) {
      throw new HttpException(
        'Demasiados intentos. Espera antes de volver a intentarlo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (response.status === 401) {
      throw new UnauthorizedException(
        'La sesión ha expirado. Vuelve a iniciar sesión.',
      );
    }
    if (response.status === 403) {
      throw new ForbiddenException('No se pudo confirmar la identidad.');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        'No se pudo confirmar la identidad. Intenta de nuevo.',
      );
    }
    let confirmation: unknown;
    try {
      confirmation = await response.json();
    } catch {
      throw new ServiceUnavailableException('Respuesta de identidad inválida.');
    }
    if (
      !confirmation ||
      typeof confirmation !== 'object' ||
      !('verified' in confirmation) ||
      confirmation.verified !== true ||
      !('subject' in confirmation) ||
      confirmation.subject !== subject ||
      !('purpose' in confirmation) ||
      confirmation.purpose !== PURPOSE
    ) {
      throw new ForbiddenException('No se pudo confirmar la identidad.');
    }
  }
}
