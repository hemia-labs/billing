import {
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HemiaLegalClientService } from 'src/modules/checkout/clients/hemia-legal-client.service';

const createResponse = (body: Record<string, unknown>, ok = true) =>
  ({
    ok,
    json: jest.fn(async () => body),
  }) as unknown as Response;

describe('HemiaLegalClientService', () => {
  let fetchMock: jest.Mock;
  let service: HemiaLegalClientService;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'hemiaLegal.baseUrl': 'https://legal.test',
          'hemiaLegal.apiKey': 'legal-secret',
        };

        return values[key];
      }),
    } as unknown as ConfigService;

    service = new HemiaLegalClientService(config);
  });

  it('validates acceptance through Hemia Legal', async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        valid: true,
        legal_acceptance_id: 'acc_123',
        terms_version: '1.0.0',
        privacy_version: '1.0.0',
        refund_policy_version: '1.0.0',
        accepted_at: '2026-06-18T00:00:00.000Z',
        legal_snapshot_hash: 'hash_123',
      }),
    );

    const result = await service.validateAcceptance({
      organizationId: 'org-id',
      legalAcceptanceId: 'acc_123',
      productCode: 'medsync',
    });

    expect(result.valid).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://legal.test/legal/acceptances/validate');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(
      'legal-secret',
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      organization_id: 'org-id',
      legal_acceptance_id: 'acc_123',
      product_code: 'medsync',
    });
  });

  it('throws bad request when legal acceptance is invalid', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ valid: false }));

    await expect(
      service.validateAcceptance({
        organizationId: 'org-id',
        legalAcceptanceId: 'acc_123',
        productCode: 'medsync',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws bad gateway when Hemia Legal fails', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({}, false));

    await expect(
      service.validateAcceptance({
        organizationId: 'org-id',
        legalAcceptanceId: 'acc_123',
        productCode: 'medsync',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
