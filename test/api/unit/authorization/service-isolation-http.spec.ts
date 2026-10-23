import {
  policyFixture,
  policyRegistry,
} from '../../helpers/service-policy-fixture';
import { BillingServiceClientRegistryService } from '../../../../apps/api/src/common/services/billing-service-client-registry.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SsoExceptionFilter } from '@hemia/auth/nestjs';
import { CheckoutInProgressException } from '../../../../apps/api/src/modules/checkout/errors/checkout-in-progress.exception';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BillingInternalAuthGuard } from '../../../../apps/api/src/common/guards/billing-internal-auth.guard';
import { BillingServicePolicyGuard } from '../../../../apps/api/src/common/guards/billing-service-policy.guard';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { SsoBearerGuard } from '../../../../apps/api/src/common/guards/sso-bearer.guard';
import { BillingServicePolicyService } from '../../../../apps/api/src/common/services/billing-service-policy.service';
import { BillingResourceContextRepository } from '../../../../apps/api/src/common/repositories/billing-resource-context.repository';
import { BillingCatalogPublicController } from '../../../../apps/api/src/modules/catalog/controllers/billing-catalog-public.controller';
import { BillingCatalogService } from '../../../../apps/api/src/modules/catalog/billing-catalog.service';
import { BillingCheckoutController } from '../../../../apps/api/src/modules/checkout/billing-checkout.controller';
import { BillingCheckoutService } from '../../../../apps/api/src/modules/checkout/billing-checkout.service';
import { BillingIntegrationsController } from '../../../../apps/api/src/modules/integrations/billing-integrations.controller';
import { BillingLicensesController } from '../../../../apps/api/src/modules/licenses/billing-licenses.controller';
import { BillingLicensesService } from '../../../../apps/api/src/modules/licenses/billing-licenses.service';
import { BillingSubscriptionsManagementController } from '../../../../apps/api/src/modules/subscriptions-management/billing-subscriptions-management.controller';
import { BillingSubscriptionsManagementService } from '../../../../apps/api/src/modules/subscriptions-management/billing-subscriptions-management.service';

const issuer = 'https://identity.test';
const clientId = 'medsync-service';
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const checkoutId = randomUUID();
const subscriptionId = randomUUID();
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

function bearer(service = clientId, scope = '*.*') {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = [
    encode({ alg: 'RS256', kid: 'identity-key', typ: 'at+jwt' }),
    encode({
      iss: issuer,
      aud: 'billing-api',
      sub: service,
      client_id: service,
      grant_type: 'client_credentials',
      scope,
      iat: now,
      exp: now + 300,
    }),
  ].join('.');
  return `Bearer ${payload}.${sign('RSA-SHA256', Buffer.from(payload), keys.privateKey).toString('base64url')}`;
}

describe('service isolation through the actual HTTP guards', () => {
  let app: INestApplication;
  let fetcher: jest.SpiedFunction<typeof fetch>;
  const body = {
    idempotencyKey: randomUUID(),
    organizationId,
    userId: randomUUID(),
    productCode: 'medsync',
    planCode: 'basic',
    planPriceCode: 'monthly',
    provider: 'paypal',
    legalAcceptanceId: randomUUID(),
    successUrl: 'https://medsync.test/success',
    cancelUrl: 'https://medsync.test/cancel',
  };
  const checkout = {
    createCheckoutSession: jest.fn(() => Promise.resolve({ checkoutId })),
    getCheckoutStatus: jest.fn(() => Promise.resolve({ checkoutId })),
  };
  const catalog = {
    listActiveProducts: jest.fn(() => Promise.resolve([])),
    listActivePlansByProduct: jest.fn(() => Promise.resolve([])),
  };
  const management = {
    cancelSubscription: jest.fn(() => Promise.resolve({ subscriptionId })),
    verifyCheckoutSession: jest.fn(() => Promise.resolve({ checkoutId })),
    changePlan: jest.fn(() => Promise.resolve({ checkoutId })),
  };
  let rows: Map<
    string,
    {
      productCode: string;
      organizationId: string;
      metadata?: Record<string, unknown>;
    }
  >;

  const http = () => request(app.getHttpServer() as Server);

  beforeEach(async () => {
    jest.clearAllMocks();
    rows = new Map([
      [
        checkoutId,
        {
          productCode: 'medsync',
          organizationId,
          metadata: { createdByIssuer: issuer, createdByClientId: clientId },
        },
      ],
      [subscriptionId, { productCode: 'medsync', organizationId }],
    ]);
    fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            {
              ...keys.publicKey.export({ format: 'jwk' }),
              kid: 'identity-key',
            },
          ],
        }),
      ),
    );
    const module = await Test.createTestingModule({
      controllers: [
        BillingLicensesController,
        BillingIntegrationsController,
        BillingCheckoutController,
        BillingCatalogPublicController,
        BillingSubscriptionsManagementController,
      ],
      providers: [
        BillingInternalAuthGuard,
        SsoBearerGuard,
        PermissionsGuard,
        BillingServicePolicyGuard,
        BillingServicePolicyService,
        {
          provide: BillingServiceClientRegistryService,
          useFactory: (config: ConfigService) => policyRegistry(config),
          inject: [ConfigService],
        },
        BillingResourceContextRepository,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            auth: {
              requiredIssuer: issuer,
              audience: 'billing-api',
              jwksUri: `${issuer}/jwks`,
              storedPolicies: policyFixture(
                JSON.stringify({
                  [clientId]: {
                    products: ['medsync'],
                    organizationScope: 'organizations',
                    organizationIds: [organizationId],
                  },
                  'other-service': {
                    products: ['medsync'],
                    organizationScope: 'organizations',
                    organizationIds: [organizationId],
                  },
                }),
              ),
            },
          }),
        },
        {
          provide: DataSource,
          useValue: {
            query: (_sql: string, [id]: string[]) =>
              Promise.resolve(rows.has(id) ? [rows.get(id)] : []),
          },
        },
        { provide: BillingCatalogService, useValue: catalog },
        { provide: BillingCheckoutService, useValue: checkout },
        {
          provide: BillingLicensesService,
          useValue: {
            resolveLicense: jest.fn(() => Promise.resolve({ active: false })),
          },
        },
        {
          provide: BillingSubscriptionsManagementService,
          useValue: management,
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new SsoExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    await app.close();
    fetcher.mockRestore();
  });

  it('creates without SSO, forwarding the verified actor from the signed token', async () => {
    await http()
      .post('/api/v1/billing/integrations/v1/checkout/sessions')
      .set('Authorization', bearer())
      .send(body)
      .expect(201);
    expect(checkout.createCheckoutSession).toHaveBeenCalledWith(body, {
      issuer,
      clientId,
    });
  });

  it.each([
    '/api/v1/billing/integrations/v1/checkout/sessions',
    '/api/v1/billing/checkout/sessions',
  ])('returns a retry hint for an active attempt through %s', async (path) => {
    checkout.createCheckoutSession.mockRejectedValueOnce(
      new CheckoutInProgressException(checkoutId, 42),
    );
    const result = await http()
      .post(path)
      .set('Authorization', bearer())
      .send(body)
      .expect(409)
      .expect('Retry-After', '42');
    expect(result.body).toMatchObject({
      statusCode: 409,
      code: 'CHECKOUT_IN_PROGRESS',
      checkoutId,
      retryAfterSeconds: 42,
    });
  });

  it('returns the same retry hint when changing a plan', async () => {
    management.changePlan.mockRejectedValueOnce(
      new CheckoutInProgressException(checkoutId, 42),
    );
    const result = await http()
      .post(`/api/v1/billing/subscriptions/${subscriptionId}/change-plan`)
      .set('Authorization', bearer())
      .send({
        idempotencyKey: body.idempotencyKey,
        actorUserId: body.userId,
        targetPlanCode: 'premium',
        targetPlanPriceCode: 'monthly',
        legalAcceptanceId: body.legalAcceptanceId,
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
      })
      .expect(409)
      .expect('Retry-After', '42');
    expect(result.body).toMatchObject({
      code: 'CHECKOUT_IN_PROGRESS',
      checkoutId,
    });
  });

  it.each([
    '/api/v1/billing/integrations/v1/checkout/sessions',
    '/api/v1/billing/checkout/sessions',
  ])('denies other products and organizations through %s', async (path) => {
    for (const change of [
      { productCode: 'other' },
      { organizationId: otherOrganizationId },
    ]) {
      await http()
        .post(path)
        .set('Authorization', bearer())
        .send({ ...body, ...change })
        .expect(403);
    }
    expect(checkout.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('does not let an unregistered signed client use wildcard scopes', async () => {
    await http()
      .post('/api/v1/billing/integrations/v1/checkout/sessions')
      .set('Authorization', bearer('unregistered-service'))
      .send(body)
      .expect(403);
    expect(checkout.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('requires the integration license scope for license resolution', async () => {
    const endpoint = '/api/v1/billing/licenses/resolve';
    const query = { organization_id: organizationId, product_code: 'medsync' };
    await http()
      .get(endpoint)
      .set(
        'Authorization',
        bearer(clientId, 'billing.integration.licenses.read'),
      )
      .query(query)
      .expect(200);
    await http()
      .get(endpoint)
      .set('Authorization', bearer(clientId, 'billing.licenses.read'))
      .query(query)
      .expect(403);
    for (const change of [
      { organization_id: otherOrganizationId },
      { product_code: 'other' },
    ]) {
      await http()
        .get(endpoint)
        .set(
          'Authorization',
          bearer(clientId, 'billing.integration.licenses.read'),
        )
        .query({ ...query, ...change })
        .expect(403);
    }
  });

  it('still requires the route scope for a registered client', async () => {
    await http()
      .post('/api/v1/billing/integrations/v1/checkout/sessions')
      .set(
        'Authorization',
        bearer(clientId, 'billing.integration.catalog.read'),
      )
      .send(body)
      .expect(403);
    expect(checkout.createCheckoutSession).not.toHaveBeenCalled();
  });

  it.each([
    '/api/v1/billing/integrations/v1/checkout/sessions',
    '/api/v1/billing/checkout/sessions',
  ])('rejects spoofed creator fields in %s', async (path) => {
    await http()
      .post(path)
      .set('Authorization', bearer())
      .send({
        ...body,
        createdByClientId: 'other-service',
        createdByIssuer: issuer,
      })
      .expect(400);
    expect(checkout.createCheckoutSession).not.toHaveBeenCalled();
  });

  it.each([
    '/api/v1/billing/integrations/v1/checkout/sessions',
    '/api/v1/billing/checkout/sessions',
  ])('hides foreign checkouts through %s/:id/status', async (path) => {
    await http()
      .get(`${path}/${checkoutId}/status`)
      .set('Authorization', bearer('other-service'))
      .query({ organization_id: organizationId })
      .expect(404);
    expect(checkout.getCheckoutStatus).not.toHaveBeenCalled();
    await http()
      .get(`${path}/${checkoutId}/status`)
      .set('Authorization', bearer())
      .expect(200);
    expect(checkout.getCheckoutStatus).toHaveBeenCalledWith(checkoutId, {
      issuer,
      clientId,
    });
  });

  it('prevents a different service from verifying a checkout even inside its allowed organization', async () => {
    await http()
      .post(`/api/v1/billing/checkout/sessions/${checkoutId}/verify`)
      .set('Authorization', bearer('other-service'))
      .send({})
      .expect(404);
    expect(management.verifyCheckoutSession).not.toHaveBeenCalled();
  });

  it('uses stored subscription scope before invoking cancellation', async () => {
    rows.get(subscriptionId)!.organizationId = otherOrganizationId;
    await http()
      .post(`/api/v1/billing/subscriptions/${subscriptionId}/cancel`)
      .set('Authorization', bearer())
      .send({ reason: 'requested', organizationId })
      .expect(404);
    expect(management.cancelSubscription).not.toHaveBeenCalled();
  });

  it.each([
    '/api/v1/billing/integrations/v1/catalog/products',
    '/api/v1/billing/catalog/products',
  ])('passes the authorized product filter for %s', async (path) => {
    await http().get(path).set('Authorization', bearer()).expect(200);
    expect(catalog.listActiveProducts).toHaveBeenCalledWith(['medsync']);
    await http()
      .get('/api/v1/billing/integrations/v1/catalog/products/other/plans')
      .set('Authorization', bearer())
      .expect(403);
    expect(catalog.listActivePlansByProduct).not.toHaveBeenCalled();
  });
});
