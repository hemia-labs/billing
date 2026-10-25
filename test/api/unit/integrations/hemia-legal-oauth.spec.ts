import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { HemiaLegalClientService } from '../../../../apps/api/src/modules/checkout/clients/hemia-legal-client.service';
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
  },
};
function documents(count = 1) {
  return Array.from({ length: count }, (_, n) => ({
    documentId: `20000000-0000-4000-8000-00000000000${n}`,
    documentVersionId: `30000000-0000-4000-8000-00000000000${n}`,
    acceptanceRuleId: `40000000-0000-4000-8000-00000000000${n}`,
    acceptanceId:
      n === 0
        ? ids.legalAcceptanceId
        : `50000000-0000-4000-8000-00000000000${n}`,
    version: `${n + 1}.0.0`,
    contentHash: 'a'.repeat(64),
    registeringClient: {
      oauthIssuer: 'http://localhost:4000',
      clientId: 'balanz-billing-service',
    },
    acceptedAt: '2026-09-22T00:00:00.000Z',
  }));
}
const proofBase = {
  contractVersion: 2,
  identitySourceId: '10000000-0000-4000-8000-000000000006',
  valid: true,
  organizationId: ids.organizationId,
  identityIssuer: 'urn:hemia:billing',
  subjectId: ids.userId,
  productCode: 'billing',
  legalAcceptanceId: ids.legalAcceptanceId,
  applicationId: ids.applicationId,
  issuerId: ids.issuerId,
  evidence: documents(),
  acceptedAt: '2026-09-22T00:00:00Z',
  legalSnapshotHash: 'a'.repeat(64),
};
function signedProof(value: typeof proofBase) {
  const {
    contractVersion,
    identitySourceId,
    issuerId,
    applicationId,
    organizationId,
    identityIssuer,
    subjectId,
    productCode,
    legalAcceptanceId,
    evidence,
  } = value;
  const snapshot = {
    contractVersion,
    identitySourceId,
    issuerId,
    applicationId,
    organizationId,
    identityIssuer,
    subjectId,
    productCode,
    legalAcceptanceId,
    evidence,
  };
  return {
    ...value,
    legalSnapshotHash: createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex'),
  };
}
const proof = signedProof(proofBase);
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
  it.each([1, 2, 4])(
    'accepts %s documents without fixed document types',
    async (count) => {
      token();
      const evidence = documents(count).reverse();
      fetcher.mockResolvedValueOnce(
        new Response(JSON.stringify(signedProof({ ...proof, evidence }))),
      );
      await expect(client.validateAcceptance(input)).resolves.toMatchObject({
        valid: true,
        evidence,
      });
    },
  );
  it('accepts the current document version verified by Legal', async () => {
    token();
    const evidence = [{ ...documents()[0], version: 'updated-version' }];
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify(signedProof({ ...proof, evidence }))),
    );
    await expect(client.validateAcceptance(input)).resolves.toMatchObject({
      evidence,
    });
  });
  it.each(['incomplete confirmations', 'changed required versions'])(
    'blocks when Legal rejects %s',
    async (reason) => {
      token();
      fetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ ...proof, valid: false, reason })),
      );
      await expect(client.validateAcceptance(input)).rejects.toMatchObject({
        status: 400,
      });
    },
  );
  it('uses client_credentials and bearer with bound consumer before accepting proof', async () => {
    token();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(proof)));
    const result = await client.validateAcceptance(input);
    expect(result.legalSnapshotHash).toBe(proof.legalSnapshotHash);
    const calls = fetcher.mock.calls as [URL, RequestInit][];
    expect(String(calls[0][0])).toBe(config.hemiaLegal.tokenUrl);
    expect(Object.fromEntries(calls[0][1].body as URLSearchParams)).toEqual({
      grant_type: 'client_credentials',
      client_id: config.hemiaLegal.clientId,
      client_secret: config.hemiaLegal.clientSecret,
      audience: 'legal-api',
      scope: 'legal.integration.acceptances.validate',
    });
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
    { ...proof, evidence: [] },
    { ...proof, evidence: undefined },
    { ...proof, contractVersion: 1 },
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
  it.each([400, 403, 401, 503])(
    'preserves buyer rejection and fails closed on upstream %s',
    async (status) => {
      token();
      fetcher.mockResolvedValueOnce(new Response(null, { status }));
      await expect(client.validateAcceptance(input)).rejects.toMatchObject({
        status: status === 400 || status === 403 ? status : 502,
      });
    },
  );
  it('uses the same contract for another product without configuration mapping', async () => {
    token();
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          signedProof({ ...proof, productCode: 'another-product' }),
        ),
      ),
    );
    await expect(
      client.validateAcceptance({ ...input, productCode: 'another-product' }),
    ).resolves.toMatchObject({ valid: true });
  });
  it('does not retry a network failure', async () => {
    fetcher.mockRejectedValueOnce(new Error('timeout'));
    await expect(client.validateAcceptance(input)).rejects.toMatchObject({
      status: 502,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('External Legal v2 evidence', () => {
  const original = global.fetch;
  const source = '10000000-0000-4000-8000-000000000006';
  const externalInput = { ...input, productCode: 'balanz_cfdi' };
  function externalProof(count = 3, version?: string) {
    const evidence = documents(count);
    if (version) evidence[0].version = version;
    const snapshot = {
      contractVersion: 2,
      identitySourceId: source,
      issuerId: ids.issuerId,
      applicationId: ids.applicationId,
      organizationId: ids.organizationId,
      identityIssuer: 'urn:hemia:balanz',
      subjectId: ids.userId,
      productCode: 'balanz_cfdi',
      legalAcceptanceId: ids.legalAcceptanceId,
      evidence,
    };
    const hash = createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex');
    return { ...proof, ...snapshot, legalSnapshotHash: hash };
  }
  function setup(value: unknown) {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'opaque',
            token_type: 'Bearer',
            expires_in: 120,
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(value)));
    global.fetch = fetcher;
    const client = new HemiaLegalClientService(
      new ConfigService({
        hemiaLegal: {
          ...config.hemiaLegal,
        },
      }),
    );
    return { client, fetcher };
  }
  afterEach(() => {
    global.fetch = original;
  });
  it.each([1, 2, 4])(
    'accepts %s external documents without legacy versions',
    async (count) => {
      const proof = externalProof(count);
      const { client } = setup(proof);
      await expect(
        client.validateAcceptance(externalInput),
      ).resolves.toMatchObject({ valid: true, evidence: proof.evidence });
    },
  );
  it('accepts the updated external version with a verified snapshot', async () => {
    const proof = externalProof(1, 'updated-version');
    const { client } = setup(proof);
    await expect(
      client.validateAcceptance(externalInput),
    ).resolves.toMatchObject({ evidence: proof.evidence });
  });
  it.each(['incomplete confirmations', 'changed required versions'])(
    'blocks external checkout when Legal rejects %s',
    async (reason) => {
      const { client } = setup({ ...externalProof(), valid: false, reason });
      await expect(
        client.validateAcceptance(externalInput),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it.each([undefined, [], 'invalid'])(
    'rejects unverifiable external evidence %s',
    async (evidence) => {
      const { client } = setup({ ...externalProof(), evidence });
      await expect(
        client.validateAcceptance(externalInput),
      ).rejects.toMatchObject({ status: 502 });
    },
  );
  it('uses external source and v2 scope without assuming SSO buyer issuer', async () => {
    const { client, fetcher } = setup(externalProof());
    await expect(
      client.validateAcceptance(externalInput),
    ).resolves.toMatchObject({ valid: true });
    const calls = fetcher.mock.calls as [URL, RequestInit][];
    expect(String(calls[1][0])).toBe(
      'http://localhost:3017/v1/legal/integrations/acceptances/validate',
    );
    expect(Object.fromEntries(calls[0][1].body as URLSearchParams)).toEqual({
      grant_type: 'client_credentials',
      client_id: config.hemiaLegal.clientId,
      client_secret: config.hemiaLegal.clientSecret,
      audience: 'legal-api',
      scope: 'legal.integration.acceptances.validate',
    });
    expect(JSON.parse(calls[1][1].body as string)).toEqual({
      organizationId: ids.organizationId,
      subjectId: ids.userId,
      productCode: 'balanz_cfdi',
      legalAcceptanceId: ids.legalAcceptanceId,
    });
  });
  it.each([
    'source',
    'issuer',
    'buyer',
    'organization',
    'hash',
    'missing',
    'duplicate',
    'version',
    'anchor',
    'v1',
  ])('rejects altered %s evidence', async (failure) => {
    const proof = externalProof();
    const bad = { ...proof };
    if (failure === 'source') bad.identitySourceId = ids.userId;
    if (failure === 'issuer') bad.identityIssuer = 'http://localhost:4000';
    if (failure === 'buyer') bad.subjectId = ids.organizationId;
    if (failure === 'organization') bad.organizationId = ids.userId;
    if (failure === 'hash') bad.legalSnapshotHash = 'b'.repeat(64);
    if (failure === 'missing') bad.evidence = bad.evidence.slice(1);
    if (failure === 'duplicate')
      bad.evidence = [bad.evidence[0], bad.evidence[0], bad.evidence[2]];
    if (failure === 'version') bad.evidence[0].version = 'changed';
    if (failure === 'anchor')
      bad.evidence[0] = { ...bad.evidence[0], acceptanceId: ids.userId };
    if (failure === 'v1') bad.contractVersion = 1;
    const { client } = setup(bad);
    await expect(
      client.validateAcceptance(externalInput),
    ).rejects.toMatchObject({ status: 502 });
  });
});
