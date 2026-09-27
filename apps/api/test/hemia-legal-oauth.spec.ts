import { ConfigService } from '@nestjs/config';
import { HemiaLegalClientService } from '../src/modules/checkout/clients/hemia-legal-client.service';
const ids = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  userId: '10000000-0000-4000-8000-000000000002',
  legalAcceptanceId: '10000000-0000-4000-8000-000000000003',
  issuerId: '10000000-0000-4000-8000-000000000004',
  applicationId: '10000000-0000-4000-8000-000000000005',
};
const input = {
  organizationId: ids.organizationId,
  userId: ids.userId,
  legalAcceptanceId: ids.legalAcceptanceId,
  productCode: 'billing',
};
const config = {
  hemiaLegal: {
    baseUrl: 'http://localhost:3017',
    tokenUrl: 'http://localhost:4000/oauth/token',
    clientId: 'billing-legal-service',
    clientSecret: 'test-only',
    identityIssuer: 'http://localhost:4000',
    products: JSON.stringify({
      billing: { issuerId: ids.issuerId, applicationId: ids.applicationId },
    }),
  },
};
const proof = {
  contractVersion: 1,
  valid: true,
  organizationId: ids.organizationId,
  identityIssuer: 'http://localhost:4000',
  subjectId: ids.userId,
  productCode: 'billing',
  legalAcceptanceId: ids.legalAcceptanceId,
  applicationId: ids.applicationId,
  issuerId: ids.issuerId,
  termsVersion: '1.0.0',
  privacyVersion: '2.0.0',
  refundPolicyVersion: '3.0.0',
  acceptedAt: '2026-09-22T00:00:00Z',
  legalSnapshotHash: 'a'.repeat(64),
};
describe('Billing Legal OAuth', () => {
  const original = global.fetch;
  let fetcher: jest.Mock;
  let client: HemiaLegalClientService;
  beforeEach(() => {
    fetcher = jest.fn();
    global.fetch = fetcher;
    client = new HemiaLegalClientService(new ConfigService(config));
  });
  afterEach(() => {
    global.fetch = original;
  });
  function token() {
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'opaque-test-token',
          token_type: 'Bearer',
          expires_in: 120,
        }),
        { status: 201 },
      ),
    );
  }
  it('uses client_credentials and bearer with bound consumer before accepting proof', async () => {
    token();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(proof)));
    const result = await client.validateAcceptance(input);
    expect(result.legalSnapshotHash).toBe(proof.legalSnapshotHash);
    const calls = fetcher.mock.calls as [URL, RequestInit][];
    expect(String(calls[0][0])).toBe(config.hemiaLegal.tokenUrl);
    expect((calls[0][1].body as URLSearchParams).get('scope')).toBe(
      'legal.acceptances.validate',
    );
    expect(calls[1][1].headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer opaque-test-token',
    });
    expect(JSON.parse(calls[1][1].body as string)).toMatchObject({
      subjectId: ids.userId,
      organizationId: ids.organizationId,
      productCode: 'billing',
    });
    expect(calls.every((c) => c[1].redirect === 'error')).toBe(true);
  });
  it.each([401, 403, 500])(
    'fails closed on token endpoint %s without reaching Legal',
    async (status) => {
      fetcher.mockResolvedValueOnce(new Response('{}', { status }));
      await expect(client.validateAcceptance(input)).rejects.toMatchObject({
        status: 502,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { ...proof, organizationId: ids.userId },
    { ...proof, subjectId: ids.organizationId },
    { ...proof, legalAcceptanceId: ids.userId },
    { ...proof, productCode: 'other' },
    { ...proof, legalSnapshotHash: '' },
    { ...proof, termsVersion: '' },
    { ...proof, contractVersion: 2 },
  ])('rejects unbound or incomplete evidence', async (result) => {
    token();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(result)));
    await expect(client.validateAcceptance(input)).rejects.toMatchObject({
      status: 502,
    });
  });
  it('does not accept no-pending response as proof', async () => {
    token();
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ canContinue: true, pendingDocuments: [] })),
    );
    await expect(client.validateAcceptance(input)).rejects.toMatchObject({
      status: 502,
    });
  });
  it('rejects invalid acceptance as business failure', async () => {
    token();
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ valid: false })),
    );
    await expect(client.validateAcceptance(input)).rejects.toMatchObject({
      status: 400,
    });
  });
  it('rejects absent product binding before network', async () => {
    await expect(
      client.validateAcceptance({ ...input, productCode: 'unknown' }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not retry a network failure', async () => {
    fetcher.mockRejectedValueOnce(new Error('timeout'));
    await expect(client.validateAcceptance(input)).rejects.toMatchObject({
      status: 502,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
