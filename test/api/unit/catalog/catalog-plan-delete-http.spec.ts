import type { Server } from 'node:http';
import 'reflect-metadata';
import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { BillingCatalogConsoleController } from '../../../../apps/api/src/modules/catalog/controllers/billing-catalog-console.controller';
import { BillingCatalogService } from '../../../../apps/api/src/modules/catalog/billing-catalog.service';
import { BillingConsoleAuthGuard } from '../../../../apps/api/src/common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { BillingServicePolicyGuard } from '../../../../apps/api/src/common/guards/billing-service-policy.guard';

const id = '10aa22b9-c0e4-4c04-8f91-5f412aaa1d79';
describe('console catalog mutation HTTP contracts', () => {
  let app: INestApplication;
  let role = 'billing.catalog_manager';
  const service = {
    deletePlan: jest.fn(),
    createProviderPrice: jest.fn(),
    updateProviderPriceStatus: jest.fn(),
    createAddonProviderPrice: jest.fn(),
    listAddonProviderPrices: jest.fn(),
    updateAddonProviderPriceStatus: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BillingCatalogConsoleController],
      providers: [
        PermissionsGuard,
        { provide: BillingCatalogService, useValue: service },
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
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    role = 'billing.catalog_manager';
    service.deletePlan.mockReset().mockResolvedValue(undefined);
  });
  afterAll(async () => app.close());

  it('creates an explicitly global provider mapping and returns scoped metadata', async () => {
    const payload = {
      provider: 'paypal',
      connectionScope: 'global',
      providerConnectionId: null,
      providerPriceId: 'P-TEST',
    };
    service.createProviderPrice.mockResolvedValue({ id, ...payload });
    const response = await request(app.getHttpServer() as Server)
      .post(`/api/v1/billing/console/catalog/plan-prices/${id}/provider-prices`)
      .send(payload)
      .expect(201);
    expect(response.body).toEqual({ id, ...payload });
    expect(service.createProviderPrice).toHaveBeenCalledWith(id, payload);
  });
  it.each([
    { provider: 'paypal', providerPriceId: 'P-TEST' },
    {
      provider: 'paypal',
      connectionScope: 'unassigned',
      providerConnectionId: null,
      providerPriceId: 'P-TEST',
    },
    {
      provider: 'paypal',
      connectionScope: 'global',
      providerConnectionId: null,
      providerPriceId: 'P-TEST',
      clientSecret: 'forbidden',
    },
  ])('rejects ambiguous mapping input and credentials %#', async (payload) => {
    await request(app.getHttpServer() as Server)
      .post(`/api/v1/billing/console/catalog/plan-prices/${id}/provider-prices`)
      .send(payload)
      .expect(400);
  });
  it('protects mapping writes with catalog.manage and validates status-only input', async () => {
    role = 'billing.viewer';
    await request(app.getHttpServer() as Server)
      .post(`/api/v1/billing/console/catalog/addons/${id}/provider-prices`)
      .send({
        provider: 'paypal',
        connectionScope: 'global',
        providerConnectionId: null,
        providerPriceId: 'P-TEST',
      })
      .expect(403);
    role = 'billing.catalog_manager';
    await request(app.getHttpServer() as Server)
      .patch(`/api/v1/billing/console/catalog/provider-prices/${id}/status`)
      .send({ status: 'archived', providerPriceId: 'P-CHANGED' })
      .expect(400);
    service.updateProviderPriceStatus.mockResolvedValue({
      id,
      status: 'archived',
    });
    await request(app.getHttpServer() as Server)
      .patch(`/api/v1/billing/console/catalog/provider-prices/${id}/status`)
      .send({ status: 'archived' })
      .expect(200);
    expect(service.updateProviderPriceStatus).toHaveBeenCalledWith(id, {
      status: 'archived',
    });
  });
  it('returns 204 with no body for an authorized manager', async () => {
    const response = await request(app.getHttpServer() as Server)
      .delete(`/api/v1/billing/console/catalog/plans/${id}`)
      .expect(204);
    expect(response.text).toBe('');
    expect(service.deletePlan).toHaveBeenCalledWith(id);
  });
  it('rejects viewers before invoking the service', async () => {
    role = 'billing.viewer';
    await request(app.getHttpServer() as Server)
      .delete(`/api/v1/billing/console/catalog/plans/${id}`)
      .expect(403);
    expect(service.deletePlan).not.toHaveBeenCalled();
  });
  it('rejects a malformed plan id', async () => {
    await request(app.getHttpServer() as Server)
      .delete('/api/v1/billing/console/catalog/plans/not-a-uuid')
      .expect(400);
    expect(service.deletePlan).not.toHaveBeenCalled();
  });
  it.each([new NotFoundException(), new ConflictException()])(
    'preserves domain rejection %s',
    async (error) => {
      service.deletePlan.mockRejectedValue(error);
      await request(app.getHttpServer() as Server)
        .delete(`/api/v1/billing/console/catalog/plans/${id}`)
        .expect(error.getStatus());
    },
  );
});
