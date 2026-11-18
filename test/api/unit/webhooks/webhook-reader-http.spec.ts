import 'reflect-metadata';
import {
  INestApplication,
  ExecutionContext,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import type { Server } from 'node:http';
import request from 'supertest';
import { BillingConsoleAuthGuard } from '../../../../apps/api/src/common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { BillingServicePolicyGuard } from '../../../../apps/api/src/common/guards/billing-service-policy.guard';
import { validateBillingContext } from '../../../../apps/api/src/modules/auth/session/billing-console-permissions';
import { BillingWebhooksConsoleController } from '../../../../apps/api/src/modules/webhooks/controllers/billing-webhooks-console.controller';
import { BillingWebhooksService } from '../../../../apps/api/src/modules/webhooks/billing-webhooks.service';
import { WebhookPayloadDownloadService } from '../../../../apps/api/src/modules/webhooks/webhook-payload-download.service';

const eventId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const membershipId = '33333333-3333-4333-8333-333333333333';
const identityReferenceId = '44444444-4444-4444-8444-444444444444';
function readerAuthorization() {
  const now = Math.floor(Date.now() / 1000);
  return validateBillingContext(
    {
      iss: 'https://access.test',
      aud: 'billing-api',
      sub: 'webhook-reader',
      identity_issuer: 'https://identity.test',
      identity_reference_id: identityReferenceId,
      organization_id: organizationId,
      membership_id: membershipId,
      product_code: 'billing',
      contract_version: 1,
      catalog_version: 2,
      context_version: 1,
      jti: eventId,
      iat: now,
      nbf: now,
      exp: now + 60,
      assignments: [
        {
          assignment_id: eventId,
          assignment_version: 1,
          role_code: 'billing.webhook_viewer',
          scope: { type: 'all_customers' },
          valid_from: 1,
          expires_at: null,
        },
      ],
    },
    {
      subject: 'webhook-reader',
      issuer: 'https://identity.test',
      identityReferenceId,
      organizationId,
      membershipId,
    },
  );
}

describe('global webhook reader HTTP authorization', () => {
  let app: INestApplication<Server>;
  const service = {
    listConsoleWebhooks: jest.fn(() =>
      Promise.resolve({ items: [], total: 0, page: 1, limit: 10 }),
    ),
    getConsoleWebhook: jest.fn(() => Promise.resolve({ id: eventId })),
    listManualRetries: jest.fn(() =>
      Promise.resolve({ items: [], total: 0, page: 1, limit: 10 }),
    ),
    retryWebhook: jest.fn(),
  };
  const payload = { download: jest.fn() };
  const database = {
    query: jest.fn(() => {
      throw new Error('Global read must not issue an ownership query');
    }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BillingWebhooksConsoleController],
      providers: [
        PermissionsGuard,
        Reflector,
        { provide: DataSource, useValue: database },
        { provide: BillingServicePolicyGuard, useValue: {} },
        { provide: BillingWebhooksService, useValue: service },
        { provide: WebhookPayloadDownloadService, useValue: payload },
      ],
    })
      .overrideGuard(BillingConsoleAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          // Signature/session verification belongs to the existing SSO boundary; exercise the real claim validator and permissions guard here.
          Object.assign(context.switchToHttp().getRequest(), {
            principal: { sub: 'webhook-reader', isMachine: false },
            billingAuthorization: readerAuthorization(),
          });
          return true;
        },
      })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it('reads the global listing, details and retry history without granting another action', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/billing/console/webhooks')
      .expect(200);
    expect(service.listConsoleWebhooks).toHaveBeenCalledWith(
      expect.anything(),
      null,
    );
    await request(app.getHttpServer())
      .get(`/api/v1/billing/console/webhooks/${eventId}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/billing/console/webhooks/${eventId}/manual-retries`)
      .expect(200);
    expect(service.getConsoleWebhook).toHaveBeenCalledWith(eventId);
    expect(service.listManualRetries).toHaveBeenCalledWith(
      eventId,
      expect.anything(),
    );
    expect(database.query).not.toHaveBeenCalled();
    expect(service.retryWebhook).not.toHaveBeenCalled();
    expect(payload.download).not.toHaveBeenCalled();
  });

  it('denies retries and raw payload downloads before any mutation or sensitive read', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/billing/console/webhooks/${eventId}/retry`)
      .send({ reason: 'Attempted escalation' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/billing/console/webhooks/${eventId}/payload/download`)
      .send({ reason: 'Attempted escalation' })
      .expect(403);
    expect(service.retryWebhook).not.toHaveBeenCalled();
    expect(payload.download).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
  });
});
