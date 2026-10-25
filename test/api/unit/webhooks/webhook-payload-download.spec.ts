import {
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthenticatedRequest } from '../../../../apps/api/src/common/types/authenticated-request.type';
import { WebhookPayloadDownloadService } from '../../../../apps/api/src/modules/webhooks/webhook-payload-download.service';
import { DownloadWebhookPayloadDto } from '../../../../apps/api/src/modules/webhooks/dtos/download-webhook-payload.dto';

const id = '6a4b9c89-b7e4-42f6-8204-94206646c80c';
const dto = { password: 'secret-password', reason: 'Investigación autorizada' };
function fixture() {
  const config = {
    getOrThrow: jest.fn().mockReturnValue('https://identity.example.test'),
  };
  const events = {
    findOne: jest.fn().mockResolvedValue({
      id,
      provider: 'paypal',
      payloadJson: { private: 'provider-data' },
    }),
    query: jest.fn().mockResolvedValue([{ organization_id: 'org' }]),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const service = new WebhookPayloadDownloadService(
    config as never,
    events as never,
    audit as never,
  );
  const request = {
    principal: { sub: 'internal-user', isMachine: false },
    ssoSubject: 'identity-user',
    ssoAuth: { accessToken: 'server-token', cookie: 'opaque-session' },
    billingOrganizationScope: ['org'],
  } as unknown as AuthenticatedRequest;
  return { events, audit, service, request, config };
}

describe('webhook payload download', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => {
    global.fetch = fetchMock as typeof fetch;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          verified: true,
          subject: 'identity-user',
          purpose: 'webhook_payload_download',
        }),
      ),
    );
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it.each([
    ['http://identity.example.test', 'development'],
    ['http://localhost:4000', 'production'],
    ['https://user:secret@identity.example.test', 'production'],
  ])(
    'never sends passwords to an unsafe Identity URL %s',
    async (issuer, nodeEnv) => {
      const f = fixture();
      f.config.getOrThrow.mockImplementation((key: string) =>
        key === 'sso.issuer' ? issuer : nodeEnv,
      );
      await expect(
        f.service.download(id, dto, f.request),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(f.events.findOne).not.toHaveBeenCalled();
    },
  );

  it('permits HTTP only for loopback in local development', async () => {
    const f = fixture();
    f.config.getOrThrow.mockImplementation((key: string) =>
      key === 'sso.issuer' ? 'http://localhost:4000' : 'development',
    );
    await expect(
      f.service.download(id, dto, f.request),
    ).resolves.toHaveProperty('buffer');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('requires a human SSO session before confirming identity or reading the payload', async () => {
    const f = fixture();
    f.request.principal!.isMachine = true;
    await expect(f.service.download(id, dto, f.request)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.events.findOne).not.toHaveBeenCalled();
    f.request.principal!.isMachine = false;
    f.request.ssoSubject = undefined;
    await expect(f.service.download(id, dto, f.request)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 500])(
    'does not read the payload when Identity returns %s',
    async (status) => {
      const f = fixture();
      fetchMock.mockResolvedValueOnce(
        new Response('upstream secret details', { status }),
      );
      await expect(
        f.service.download(id, dto, f.request),
      ).rejects.toBeInstanceOf(HttpException);
      expect(f.events.findOne).not.toHaveBeenCalled();
      expect(f.audit.record).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      verified: false,
      subject: 'identity-user',
      purpose: 'webhook_payload_download',
    },
    {
      verified: true,
      subject: 'different-user',
      purpose: 'webhook_payload_download',
    },
    {
      verified: true,
      subject: 'internal-user',
      purpose: 'webhook_payload_download',
    },
    { verified: true, subject: 'identity-user', purpose: 'another-purpose' },
  ])(
    'fails closed when the confirmation is not for this SSO user and purpose: %j',
    async (confirmation) => {
      const f = fixture();
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(confirmation)),
      );
      await expect(
        f.service.download(id, dto, f.request),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.events.findOne).not.toHaveBeenCalled();
    },
  );

  it('uses only the configured Identity endpoint and audits before returning the JSON file', async () => {
    const f = fixture();
    const result = await f.service.download(id, dto, f.request);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://identity.example.test/api/v1/auth/reauthenticate'),
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: expect.any(AbortSignal) as unknown,
        headers: {
          Authorization: 'Bearer server-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: dto.password,
          purpose: 'webhook_payload_download',
        }),
      }),
    );
    expect(result.filename).toBe(`webhook-${id}.json`);
    expect(JSON.parse(result.buffer.toString())).toEqual({
      private: 'provider-data',
    });
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'internal-user',
        organizationId: 'org',
        action: 'billing.webhook.payload_download',
        resourceId: id,
        metadata: { downloadReason: dto.reason },
      }),
    );
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toMatch(
      /secret-password|server-token|provider-data/,
    );
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      f.events.findOne.mock.invocationCallOrder[0],
    );
    expect(f.events.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      f.audit.record.mock.invocationCallOrder[0],
    );
  });

  it('does not return a payload when writing the audit fails', async () => {
    const f = fixture();
    f.audit.record.mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(f.service.download(id, dto, f.request)).rejects.toThrow(
      'Audit unavailable',
    );
  });

  it('rechecks the event organization before audit and return', async () => {
    const f = fixture();
    f.events.query.mockResolvedValueOnce([{ organization_id: 'other-org' }]);
    await expect(f.service.download(id, dto, f.request)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('sanitizes network and timeout failures without exposing secrets', async () => {
    const f = fixture();
    fetchMock.mockRejectedValueOnce(
      new Error('secret-password server-token upstream'),
    );
    await expect(f.service.download(id, dto, f.request)).rejects.toEqual(
      new ServiceUnavailableException(
        'No se pudo confirmar la identidad. Intenta de nuevo.',
      ),
    );
    expect(f.events.findOne).not.toHaveBeenCalled();
  });

  it('limits identity confirmation to eight seconds and rejects timeout errors', async () => {
    const f = fixture();
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockRejectedValueOnce(
      new DOMException('Request timed out', 'TimeoutError'),
    );
    try {
      await expect(
        f.service.download(id, dto, f.request),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(timeout).toHaveBeenCalledWith(8_000);
      expect(f.events.findOne).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });

  it('bounds the password and requires a trimmed reason', async () => {
    const valid = plainToInstance(DownloadWebhookPayloadDto, {
      ...dto,
      reason: '  Investigación  ',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.reason).toBe('Investigación');
    for (const input of [
      { ...dto, password: '' },
      { ...dto, password: 'x'.repeat(1025) },
      { ...dto, reason: '   ' },
      { ...dto, reason: 'x'.repeat(251) },
    ]) {
      expect(
        (await validate(plainToInstance(DownloadWebhookPayloadDto, input)))
          .length,
      ).toBeGreaterThan(0);
    }
  });
});
