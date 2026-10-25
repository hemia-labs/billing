import {
  type INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { BillingConsoleAuthGuard } from '../../../../apps/api/src/common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { BillingWebhooksConsoleController } from '../../../../apps/api/src/modules/webhooks/controllers/billing-webhooks-console.controller';
import { BillingWebhooksService } from '../../../../apps/api/src/modules/webhooks/billing-webhooks.service';
import { WebhookPayloadDownloadService } from '../../../../apps/api/src/modules/webhooks/webhook-payload-download.service';

const id = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';

describe('Webhook payload attachment endpoint', () => {
  let app: INestApplication<Server>;
  const download = jest.fn();
  const owner = jest.fn();

  beforeAll(async () => {
    const guard = new PermissionsGuard(
      new Reflector(),
      { query: owner } as never,
      {} as never,
    );
    const module = await Test.createTestingModule({
      controllers: [BillingWebhooksConsoleController],
      providers: [
        { provide: BillingWebhooksService, useValue: {} },
        { provide: WebhookPayloadDownloadService, useValue: { download } },
      ],
    })
      .overrideGuard(BillingConsoleAuthGuard)
      .useValue({
        canActivate(context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) {
          const req = context.switchToHttp().getRequest();
          const headers = req.headers as Record<string, string>;
          if (!headers['x-test-role']) throw new UnauthorizedException();
          req.principal = { sub: id, isMachine: false };
          req.billingAuthorization = {
            expiresAt: Math.floor(Date.now() / 1000) + 60,
            assignments: [
              {
                assignment_id: id,
                assignment_version: 1,
                role_code: headers['x-test-role'],
                scope: {
                  type: 'organizations',
                  organization_ids: [organizationId],
                },
                valid_from: 1,
                expires_at: null,
              },
            ],
          };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue(guard)
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    download.mockReset().mockResolvedValue({
      buffer: Buffer.from('{"private":"example"}'),
      filename: `webhook-${id}.json`,
    });
    owner.mockReset().mockResolvedValue([{ organization_id: organizationId }]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns only an attachment after validated POST', async () => {
    const response = await request(app.getHttpServer())
      .post(`/billing/console/webhooks/${id}/payload/download`)
      .set('x-test-role', 'billing.integration_operator')
      .send({ password: 'test-password', reason: 'Investigación del evento' })
      .expect(200);
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="webhook-${id}.json"`,
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-type']).toContain('application/json');
    expect(download).toHaveBeenCalledTimes(1);
  });
  it('does not expose a GET download route', async () => {
    await request(app.getHttpServer())
      .get(`/billing/console/webhooks/${id}/payload/download`)
      .expect(404);
    expect(download).not.toHaveBeenCalled();
  });
  it('requires an authenticated session', async () => {
    await request(app.getHttpServer())
      .post(`/billing/console/webhooks/${id}/payload/download`)
      .send({ password: 'test-password', reason: 'Investigar' })
      .expect(401);
    expect(download).not.toHaveBeenCalled();
  });
  it('rejects read-only users and resources outside the organization scope', async () => {
    await request(app.getHttpServer())
      .post(`/billing/console/webhooks/${id}/payload/download`)
      .set('x-test-role', 'billing.auditor')
      .send({ password: 'test-password', reason: 'Investigar' })
      .expect(403);
    owner.mockResolvedValue([{ organization_id: null }]);
    await request(app.getHttpServer())
      .post(`/billing/console/webhooks/${id}/payload/download`)
      .set('x-test-role', 'billing.integration_operator')
      .send({ password: 'test-password', reason: 'Investigar' })
      .expect(403);
    expect(download).not.toHaveBeenCalled();
  });
  it.each([
    { reason: 'Investigar' },
    { password: 'test-password', reason: '' },
    { password: 'test-password', reason: 'Investigar', payload: {} },
  ])(
    'rejects invalid download input before accessing payload',
    async (body) => {
      await request(app.getHttpServer())
        .post(`/billing/console/webhooks/${id}/payload/download`)
        .set('x-test-role', 'billing.integration_operator')
        .send(body)
        .expect(400);
      expect(download).not.toHaveBeenCalled();
    },
  );
});
