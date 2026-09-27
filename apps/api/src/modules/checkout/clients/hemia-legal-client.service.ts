import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import {
  HemiaLegalValidationResult,
  ValidateLegalAcceptanceInput,
} from '../types';

@Injectable()
export class HemiaLegalClientService {
  constructor(private readonly config: ConfigService) {}
  async validateAcceptance(
    input: ValidateLegalAcceptanceInput,
  ): Promise<HemiaLegalValidationResult> {
    if (
      ![input.organizationId, input.userId, input.legalAcceptanceId].every(
        (id) => isUUID(id),
      )
    )
      throw new BadRequestException('Invalid legal acceptance context');
    let tokenUrl: URL,
      url: URL,
      clientId: string,
      secret: string,
      identityIssuer: string,
      target: { issuerId: string; applicationId: string };
    try {
      tokenUrl = this.endpoint(
        this.config.getOrThrow<string>('hemiaLegal.tokenUrl'),
      );
      url = new URL(
        '/v1/legal/acceptances/validate',
        this.endpoint(this.config.getOrThrow<string>('hemiaLegal.baseUrl')),
      );
      clientId = this.config.getOrThrow<string>('hemiaLegal.clientId');
      secret = this.config.getOrThrow<string>('hemiaLegal.clientSecret');
      identityIssuer = this.config.getOrThrow<string>(
        'hemiaLegal.identityIssuer',
      );
      const products = JSON.parse(
        this.config.getOrThrow<string>('hemiaLegal.products'),
      ) as Record<string, { issuerId: string; applicationId: string }>;
      if (!Object.hasOwn(products, input.productCode)) throw new Error();
      target = products[input.productCode];
      if (
        !secret ||
        !clientId ||
        !identityIssuer ||
        !isUUID(target?.issuerId) ||
        !isUUID(target?.applicationId)
      )
        throw new Error();
    } catch {
      throw new ServiceUnavailableException(
        'Legal OAuth integration is not configured',
      );
    }
    let response: Response, body: unknown;
    try {
      const issued = await fetch(tokenUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: secret,
          scope: 'legal.acceptances.validate',
        }),
      });
      if (!issued.ok) throw new Error();
      const token: unknown = await issued.json();
      if (
        !record(token) ||
        typeof token.access_token !== 'string' ||
        !token.access_token ||
        token.token_type !== 'Bearer' ||
        typeof token.expires_in !== 'number' ||
        token.expires_in <= 0
      )
        throw new Error();
      response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + token.access_token,
        },
        body: JSON.stringify({
          ...target,
          organizationId: input.organizationId,
          identityIssuer,
          subjectId: input.userId,
          productCode: input.productCode,
          legalAcceptanceId: input.legalAcceptanceId,
        }),
      });
      body = await response.json();
    } catch {
      throw new BadGatewayException('Legal authorization unavailable');
    }
    if (!response.ok)
      throw new BadGatewayException('Legal authorization unavailable');
    if (!record(body) || typeof body.valid !== 'boolean')
      throw new BadGatewayException('Invalid Legal response');
    if (!body.valid)
      throw new BadRequestException('Legal acceptance is not valid');
    if (
      body.contractVersion !== 1 ||
      body.organizationId !== input.organizationId ||
      body.identityIssuer !== identityIssuer ||
      body.subjectId !== input.userId ||
      body.productCode !== input.productCode ||
      body.legalAcceptanceId !== input.legalAcceptanceId ||
      body.applicationId !== target.applicationId ||
      body.issuerId !== target.issuerId ||
      !['termsVersion', 'privacyVersion', 'refundPolicyVersion'].every(
        (k) =>
          typeof body[k] === 'string' &&
          body[k].length > 0 &&
          body[k].length <= 50,
      ) ||
      typeof body.acceptedAt !== 'string' ||
      !Number.isFinite(Date.parse(body.acceptedAt)) ||
      typeof body.legalSnapshotHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.legalSnapshotHash)
    )
      throw new BadGatewayException('Invalid Legal evidence binding');
    return {
      valid: true,
      legalAcceptanceId: input.legalAcceptanceId,
      termsVersion: body.termsVersion as string,
      privacyVersion: body.privacyVersion as string,
      refundPolicyVersion: body.refundPolicyVersion as string,
      acceptedAt: body.acceptedAt,
      legalSnapshotHash: body.legalSnapshotHash,
      raw: body,
    };
  }
  private endpoint(value: string) {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
          process.env.NODE_ENV !== 'production'
        ))
    )
      throw new Error();
    return url;
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
