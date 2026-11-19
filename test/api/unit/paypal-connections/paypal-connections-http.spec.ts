import type { Server } from 'node:http';
import 'reflect-metadata';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  ConflictException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { PaypalConnectionsController } from '../../../../apps/api/src/modules/paypal-connections/paypal-connections.controller';
import { PaypalConnectionsService } from '../../../../apps/api/src/modules/paypal-connections/paypal-connections.service';
import { BillingConsoleAuthGuard } from '../../../../apps/api/src/common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { BillingServicePolicyGuard } from '../../../../apps/api/src/common/guards/billing-service-policy.guard';
const id = '9a0443df-d577-4745-8b0c-3ad7a4aedbff',
  connectionId = '10aa22b9-c0e4-4c04-8f91-5f412aaa1d79';
const path = `/api/v1/billing/console/catalog/products/${id}`;
const payload = {
  name: 'PayPal',
  environment: 'sandbox',
  clientId: 'app-a',
  clientSecret: 'secret-a',
  webhookId: '',
};
describe('product PayPal admin HTTP contract', () => {
  let app: INestApplication,
    role = 'billing.catalog_manager';
  const service = {
    get: jest.fn<Promise<unknown>, unknown[]>(),
    save: jest.fn<Promise<unknown>, unknown[]>(),
    list: jest.fn<Promise<unknown>, unknown[]>(),
    rotate: jest.fn<Promise<unknown>, unknown[]>(),
    activate: jest.fn<Promise<unknown>, unknown[]>(),
    setStatus: jest.fn<Promise<unknown>, unknown[]>(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PaypalConnectionsController],
      providers: [
        PermissionsGuard,
        { provide: PaypalConnectionsService, useValue: service },
        { provide: DataSource, useValue: {} },
        { provide: BillingServicePolicyGuard, useValue: {} },
      ],
    })
      .overrideGuard(BillingConsoleAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          Object.assign(context.switchToHttp().getRequest(), {
            principal: { isMachine: false },
            billingAuthorization: {
              expiresAt: Math.floor(Date.now() / 1000) + 60,
              assignments: [
                {
                  role_code: role,
                  scope: {
                    type:
                      role === 'billing.catalog_manager'
                        ? 'catalog_global'
                        : 'all_customers',
                  },
                  valid_from: 1,
                  expires_at: null,
                },
              ],
            },
          });
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    role = 'billing.catalog_manager';
    for (const mock of Object.values(service))
      mock.mockReset().mockResolvedValue({
        connection: null,
        draft: null,
        source: 'global',
        encryptionConfigured: true,
      });
  });
  afterAll(async () => app.close());
  it('reads current/history without cache and uses catalog read policy', async () => {
    await request(app.getHttpServer() as Server)
      .get(path + '/paypal-connection')
      .expect('Cache-Control', 'no-store')
      .expect(200);
    expect(service.get).toHaveBeenCalledWith(id);
    await request(app.getHttpServer() as Server)
      .get(path + '/paypal-connections')
      .expect(200);
    expect(service.list).toHaveBeenCalledWith(id);
  });
  it('saves a separate draft with empty webhook and transformed explicit fields', async () => {
    await request(app.getHttpServer() as Server)
      .put(path + '/paypal-connection')
      .send({ ...payload, name: ' PayPal ' })
      .expect(200);
    expect(service.save).toHaveBeenCalledWith(
      id,
      expect.objectContaining(payload),
    );
    expect(service.save.mock.calls[0][1]).not.toHaveProperty('token');
  });
  it.each([null, '', 7])(
    'rejects invalid optional client secret %s',
    async (clientSecret) => {
      await request(app.getHttpServer() as Server)
        .put(path + '/paypal-connection')
        .send({ ...payload, clientSecret })
        .expect(400);
      expect(service.save).not.toHaveBeenCalled();
    },
  );
  it('requires catalog manage for saving and historical credential rotation', async () => {
    role = 'billing.viewer';
    await request(app.getHttpServer() as Server)
      .put(path + '/paypal-connection')
      .send(payload)
      .expect(403);
    await request(app.getHttpServer() as Server)
      .patch(path + '/paypal-connections/' + connectionId)
      .send({ clientSecret: 'new' })
      .expect(403);
    expect(service.save).not.toHaveBeenCalled();
    expect(service.rotate).not.toHaveBeenCalled();
  });
  it('historical rotation accepts only secret and webhook, preserving identity fields', async () => {
    await request(app.getHttpServer() as Server)
      .patch(path + '/paypal-connections/' + connectionId)
      .send({
        clientSecret: 'new',
      })
      .expect(200);
    expect(service.rotate).toHaveBeenCalledWith(
      id,
      connectionId,
      expect.objectContaining({ clientSecret: 'new' }),
    );
    expect(service.rotate.mock.calls[0][2]).not.toHaveProperty('clientId');
    expect(service.rotate.mock.calls[0][2]).not.toHaveProperty('isCurrent');
  });
  it('validates UUIDs and new connection inputs before reaching persistence', async () => {
    await request(app.getHttpServer() as Server)
      .get(
        '/api/v1/billing/console/catalog/products/not-uuid/paypal-connection',
      )
      .expect(400);
    await request(app.getHttpServer() as Server)
      .put(path + '/paypal-connection')
      .send({ ...payload, environment: 'custom' })
      .expect(400);
    expect(service.get).not.toHaveBeenCalled();
    expect(service.save).not.toHaveBeenCalled();
  });
  it('rejects legacy enabled writes so saving cannot silently activate a draft', async () => {
    await request(app.getHttpServer() as Server)
      .put(path + '/paypal-connection')
      .send({ ...payload, enabled: true })
      .expect(400);
    expect(service.save).not.toHaveBeenCalled();
  });
  it('activates only the named draft with explicit current and draft revisions', async () => {
    const body = {
      expectedUpdatedAt: '2026-11-11T00:00:00.000Z',
      expectedCurrentConnectionId: null,
      expectedCurrentUpdatedAt: null,
    };
    await request(app.getHttpServer() as Server)
      .post(path + '/paypal-connections/' + connectionId + '/activate')
      .send(body)
      .expect(200);
    expect(service.activate).toHaveBeenCalledWith(
      id,
      connectionId,
      expect.objectContaining(body),
    );
    service.activate.mockRejectedValueOnce(
      new ConflictException('PayPal draft changed'),
    );
    await request(app.getHttpServer() as Server)
      .post(path + '/paypal-connections/' + connectionId + '/activate')
      .send(body)
      .expect(409);
  });
  it('rejects activation without a complete revision context', async () => {
    await request(app.getHttpServer() as Server)
      .post(path + '/paypal-connections/' + connectionId + '/activate')
      .send({ expectedUpdatedAt: '2026-11-11T00:00:00.000Z' })
      .expect(400);
    expect(service.activate).not.toHaveBeenCalled();
  });
  it('changes only current enabled state through its separate status endpoint', async () => {
    await request(app.getHttpServer() as Server)
      .patch(path + '/paypal-connections/' + connectionId + '/status')
      .send({ enabled: false })
      .expect(200);
    expect(service.setStatus).toHaveBeenCalledWith(id, connectionId, {
      enabled: false,
    });
    await request(app.getHttpServer() as Server)
      .patch(path + '/paypal-connections/' + connectionId + '/status')
      .send({ enabled: 'false' })
      .expect(400);
  });
  it('requires catalog manage for draft activation and current status changes', async () => {
    role = 'billing.viewer';
    await request(app.getHttpServer() as Server)
      .post(path + '/paypal-connections/' + connectionId + '/activate')
      .send({})
      .expect(403);
    await request(app.getHttpServer() as Server)
      .patch(path + '/paypal-connections/' + connectionId + '/status')
      .send({ enabled: false })
      .expect(403);
    expect(service.activate).not.toHaveBeenCalled();
    expect(service.setStatus).not.toHaveBeenCalled();
  });
  it('validates stale draft save identifiers and optimistic timestamps', async () => {
    await request(app.getHttpServer() as Server)
      .put(path + '/paypal-connection')
      .send({ ...payload, draftId: 'bad', expectedUpdatedAt: 'bad' })
      .expect(400);
    expect(service.save).not.toHaveBeenCalled();
  });
});
