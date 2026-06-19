import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    const response = await fetch(
      `${this.baseUrl}/legal/acceptances/validate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({
          organization_id: input.organizationId,
          legal_acceptance_id: input.legalAcceptanceId,
          product_code: input.productCode,
        }),
      },
    ).catch((error: unknown) => {
      throw new BadGatewayException('Hemia Legal validation failed', {
        cause: error,
      });
    });

    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      throw new BadGatewayException('Hemia Legal validation failed');
    }

    const result = this.mapValidationResult(body);

    if (!result.valid) {
      throw new BadRequestException('Legal acceptance is not valid');
    }

    return result;
  }

  private mapValidationResult(
    body: Record<string, unknown>,
  ): HemiaLegalValidationResult {
    return {
      valid: body.valid === true,
      legalAcceptanceId: String(body.legalAcceptanceId ?? body.legal_acceptance_id ?? ''),
      termsVersion: String(body.termsVersion ?? body.terms_version ?? ''),
      privacyVersion: String(body.privacyVersion ?? body.privacy_version ?? ''),
      refundPolicyVersion: String(
        body.refundPolicyVersion ?? body.refund_policy_version ?? '',
      ),
      acceptedAt: String(body.acceptedAt ?? body.accepted_at ?? ''),
      legalSnapshotHash: String(
        body.legalSnapshotHash ?? body.legal_snapshot_hash ?? '',
      ),
      raw: body,
    };
  }

  private get baseUrl(): string {
    return this.config.get<string>('hemiaLegal.baseUrl') ?? '';
  }

  private get apiKey(): string {
    return this.config.get<string>('hemiaLegal.apiKey') ?? '';
  }
}
