import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
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
    let external = input.productCode === 'balanz_cfdi';
    let tokenUrl: URL,
      url: URL,
      clientId: string,
      secret: string,
      identityIssuer: string,
      target:
        | {
            issuerId: string;
            applicationId: string;
            identitySourceId?: string;
            identityIssuer?: string;
          }
        | undefined;
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
      identityIssuer = this.config.get<string>('hemiaLegal.identityIssuer', '');
      if (!external) {
        const products = JSON.parse(
          this.config.getOrThrow<string>('hemiaLegal.products'),
        ) as Record<string, NonNullable<typeof target>>;
        if (!Object.hasOwn(products, input.productCode)) throw new Error();
        target = products[input.productCode];
        external = target?.identitySourceId !== undefined;
      }
      if (external) {
        url = new URL('/v1/legal/integrations/acceptances/validate', url);
      } else if (
        !identityIssuer ||
        !isUUID(target?.issuerId) ||
        !isUUID(target?.applicationId)
      ) {
        throw new Error();
      }
      if (!secret || !clientId) throw new Error();
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
          scope: external
            ? 'legal.integration.acceptances.validate'
            : 'legal.acceptances.validate',
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
          ...(external
            ? {}
            : {
                issuerId: target!.issuerId,
                applicationId: target!.applicationId,
                identityIssuer,
              }),
          organizationId: input.organizationId,
          subjectId: input.userId,
          productCode: input.productCode,
          legalAcceptanceId: input.legalAcceptanceId,
        }),
      });
      body = response.ok ? await response.json() : null;
    } catch {
      throw new BadGatewayException('Legal authorization unavailable');
    }
    if (response.status === 403)
      throw new ForbiddenException('Legal denied checkout authorization');
    if (response.status === 400)
      throw new BadRequestException('Legal rejected the acceptance context');
    if (!response.ok)
      throw new BadGatewayException('Legal authorization unavailable');
    if (!record(body) || typeof body.valid !== 'boolean')
      throw new BadGatewayException('Invalid Legal response');
    if (!body.valid)
      throw new BadRequestException('Legal acceptance is not valid');
    if (
      body.contractVersion !== (external ? 2 : 1) ||
      (external &&
        (!isUUID(body.identitySourceId) ||
          !isUUID(body.issuerId) ||
          !isUUID(body.applicationId) ||
          typeof body.identityIssuer !== 'string' ||
          !/^urn:hemia:[a-z][a-z0-9_-]{1,80}$/.test(body.identityIssuer))) ||
      body.organizationId !== input.organizationId ||
      (!external && body.identityIssuer !== identityIssuer) ||
      body.subjectId !== input.userId ||
      body.productCode !== input.productCode ||
      body.legalAcceptanceId !== input.legalAcceptanceId ||
      (!external && body.applicationId !== target!.applicationId) ||
      (!external && body.issuerId !== target!.issuerId) ||
      typeof body.acceptedAt !== 'string' ||
      !Number.isFinite(Date.parse(body.acceptedAt)) ||
      typeof body.legalSnapshotHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.legalSnapshotHash)
    )
      throw new BadGatewayException('Invalid Legal evidence binding');
    this.verifyEvidence(body, external);
    return {
      valid: true,
      legalAcceptanceId: input.legalAcceptanceId,
      acceptedAt: body.acceptedAt,
      legalSnapshotHash: body.legalSnapshotHash,
      evidence: body.evidence as Record<string, unknown>[],
      raw: body,
    };
  }
  private verifyEvidence(body: Record<string, unknown>, external: boolean) {
    const evidence = body.evidence;
    if (
      !Array.isArray(evidence) ||
      evidence.length === 0 ||
      evidence.some(
        (e) =>
          !record(e) ||
          ![
            'documentId',
            'documentVersionId',
            'acceptanceRuleId',
            'acceptanceId',
          ].every((k) => typeof e[k] === 'string' && isUUID(e[k])) ||
          typeof e.version !== 'string' ||
          !e.version ||
          (external &&
            (!record(e.registeringClient) ||
              typeof e.registeringClient.oauthIssuer !== 'string' ||
              !e.registeringClient.oauthIssuer ||
              typeof e.registeringClient.clientId !== 'string' ||
              !e.registeringClient.clientId)) ||
          typeof e.contentHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(e.contentHash) ||
          typeof e.acceptedAt !== 'string' ||
          !Number.isFinite(Date.parse(e.acceptedAt)) ||
          Date.parse(e.acceptedAt) > Date.now(),
      )
    )
      throw new BadGatewayException('Invalid Legal evidence');
    const rows = evidence as Record<string, unknown>[];
    if (
      new Set(rows.map((e) => e.documentId)).size !== rows.length ||
      new Set(rows.map((e) => e.documentVersionId)).size !== rows.length ||
      new Set(rows.map((e) => e.acceptanceId)).size !== rows.length ||
      !rows.some((e) => e.acceptanceId === body.legalAcceptanceId) ||
      Date.parse(body.acceptedAt as string) !==
        Math.max(...rows.map((e) => Date.parse(e.acceptedAt as string)))
    )
      throw new BadGatewayException('Invalid Legal documents');
    if (!external) return;
    const snapshot = {
      contractVersion: 2,
      identitySourceId: body.identitySourceId,
      issuerId: body.issuerId,
      applicationId: body.applicationId,
      organizationId: body.organizationId,
      identityIssuer: body.identityIssuer,
      subjectId: body.subjectId,
      productCode: body.productCode,
      legalAcceptanceId: body.legalAcceptanceId,
      evidence: rows,
    };
    if (
      createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') !==
      body.legalSnapshotHash
    )
      throw new BadGatewayException('Invalid external Legal snapshot');
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
