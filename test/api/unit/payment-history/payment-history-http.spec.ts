import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BillingPaymentHistoryController } from '../../../../apps/api/src/modules/payment-history/billing-payment-history.controller';
import { BillingPaymentHistoryService } from '../../../../apps/api/src/modules/payment-history/billing-payment-history.service';
import { BillingInternalAuthGuard } from '../../../../apps/api/src/common/guards/billing-internal-auth.guard';
import { BillingServicePolicyGuard } from '../../../../apps/api/src/common/guards/billing-service-policy.guard';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { SsoBearerGuard } from '../../../../apps/api/src/common/guards/sso-bearer.guard';
import { BillingServicePolicyService } from '../../../../apps/api/src/common/services/billing-service-policy.service';
import { BillingServiceClientRegistryService } from '../../../../apps/api/src/common/services/billing-service-client-registry.service';
import { BillingResourceContextRepository } from '../../../../apps/api/src/common/repositories/billing-resource-context.repository';
import { policyFixture, policyRegistry } from '../../helpers/service-policy-fixture';

const issuer = 'https://identity-history.test', clientId = 'medsync-history', organizationId = randomUUID();
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
function bearer(scope = 'billing.subscriptions.manage', machine = true) {
  const now = Math.floor(Date.now() / 1000), encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'RS256', kid: 'history', typ: 'at+jwt' })}.${encode({ iss: issuer, aud: 'billing-api', sub: clientId,
    client_id: clientId, grant_type: machine ? 'client_credentials' : 'authorization_code', scope, iat: now, exp: now + 300 })}`;
  return `Bearer ${payload}.${sign('RSA-SHA256', Buffer.from(payload), keys.privateKey).toString('base64url')}`;
}

describe('payment history integration HTTP authorization', () => {
  let app: INestApplication;
  const service = { list: jest.fn(async () => ({ items: [], nextCursor: null })) };
  beforeAll(async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'history' }] }));
    const module = await Test.createTestingModule({ controllers: [BillingPaymentHistoryController], providers: [
      BillingInternalAuthGuard, BillingServicePolicyGuard, PermissionsGuard, SsoBearerGuard, BillingServicePolicyService, BillingResourceContextRepository,
      { provide: ConfigService, useValue: new ConfigService({ auth: { requiredIssuer: issuer, audience: 'billing-api', jwksUri: issuer + '/jwks', storedPolicies:
        policyFixture(JSON.stringify({ [clientId]: { products: ['medsync'], organizationScope: 'organizations', organizationIds: [organizationId] } })) } }) },
      { provide: BillingServiceClientRegistryService, useFactory: (config: ConfigService) => policyRegistry(config), inject: [ConfigService] },
      { provide: DataSource, useValue: { query: () => { throw new Error('No database lookup permitted'); } } },
      { provide: BillingPaymentHistoryService, useValue: service },
    ] }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { await app.close(); jest.restoreAllMocks(); });
  beforeEach(() => service.list.mockClear());
  const get = (query: Record<string, unknown> = {}, token: string | null = bearer()) => {
    const req = request(app.getHttpServer() as Server).get('/api/v1/billing/payments').query({ organization_id: organizationId, product_code: 'medsync', ...query });
    return token ? req.set('Authorization', token) : req;
  };
  it('requires verified machine authentication and the existing subscriptions scope', async () => {
    await get({}, null).expect(401); await get({}, bearer('billing.integration.checkout.read')).expect(403);
    await get({}, bearer('billing.subscriptions.manage', false)).expect(401); expect(service.list).not.toHaveBeenCalled();
  });
  it('rejects another organization/product and untrusted filters before service reads', async () => {
    await get({ organization_id: randomUUID() }).expect(403); await get({ product_code: 'foreign' }).expect(403);
    await get({ limit: 100 }).expect(400); await get({ cursor: ['a', 'b'] }).expect(400); await get({ cursor: 'x'.repeat(2049) }).expect(400);
    expect(service.list).not.toHaveBeenCalled();
  });
  it('returns a non-cacheable read-only page with the verified service actor', async () => {
    const response = await get().expect(200);
    expect(response.body).toEqual({ items: [], nextCursor: null }); expect(response.headers['cache-control']).toBe('no-store');
    expect(service.list).toHaveBeenCalledWith({ organization_id: organizationId, product_code: 'medsync' }, { issuer, clientId });
  });
});
