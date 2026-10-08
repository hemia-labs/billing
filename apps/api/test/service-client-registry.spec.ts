import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BillingServiceClientRegistryService } from '../src/common/services/billing-service-client-registry.service';
import { BillingServicePolicyService } from '../src/common/services/billing-service-policy.service';
import { BillingServiceClientsService } from '../src/modules/integrations/billing-service-clients.service';
import { BillingServiceClientsController } from '../src/modules/integrations/billing-service-clients.controller';
import { SaveServiceClientDto } from '../src/modules/integrations/dtos/save-service-client.dto';
import { parseBillingServiceClients } from '../src/config/billing-service-clients';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { BillingConsoleAuthGuard } from '../src/common/guards/billing-console-auth.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BillingServiceClientEntity } from '../src/common/entities/billing-service-client.entity';

const actor = { issuer: 'https://identity.test', clientId: 'balanz-service' };
const organizationId = '63a13f20-5774-4e85-9bf1-079d83046ed5';
const otherOrganizationId = 'c36fc602-2527-4cb2-b77c-2c6cbbcb0533';
function fixture() {
  const legacy = parseBillingServiceClients(
    JSON.stringify({
      [actor.clientId]: {
        products: ['balanz_cfdi'],
        organizationScope: 'all_for_allowed_products',
        allowedReturnOrigins: ['https://old.test'],
      },
    }),
  );
  let row: { id: string; clientId: string; policy: unknown } | undefined;
  const clients = {
    find: jest.fn(async () => (row ? [row] : [])),
    findOne: jest.fn(async () => row),
    findOneByOrFail: jest.fn(async () => row!),
    upsert: jest.fn(async (input: { clientId: string; policy: unknown }) => {
      row = { id: organizationId, ...input };
    }),
    manager: { transaction: jest.fn() },
  };
  const manager = { getRepository: jest.fn(() => clients) };
  clients.manager.transaction.mockImplementation(async (callback) =>
    callback(manager),
  );
  const products = { find: jest.fn(async () => [{ code: 'balanz_cfdi' }]) };
  const audit = { record: jest.fn(async () => undefined) };
  const config = new ConfigService({
    app: { nodeEnv: 'production' },
    auth: { requiredIssuer: actor.issuer, serviceClients: legacy },
  });
  const registry = new BillingServiceClientRegistryService(clients as never);
  const policy = new BillingServicePolicyService(config, registry);
  const service = new BillingServiceClientsService(
    clients as never,
    products as never,
    config,
    audit as never,
  );
  const dto: SaveServiceClientDto = {
    enabled: true,
    products: ['balanz_cfdi'],
    organizationScope: 'organizations',
    organizationIds: [organizationId],
    allowedReturnOrigins: ['https://balanz.test'],
  };
  return { clients, manager, audit, registry, service, policy, dto, products };
}

describe('consumer registry and live authorization', () => {
  it('lists environment clients without writing and replaces them with saved policies', async () => {
    const f = fixture();
    expect(await f.service.list()).toEqual([
      expect.objectContaining({
        clientId: actor.clientId,
        source: 'environment',
      }),
    ]);
    expect(f.clients.upsert).not.toHaveBeenCalled();
    const saved = await f.service.save(actor.clientId, f.dto, 'administrator');
    expect(await f.service.list()).toEqual([saved]);
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        manager: f.manager,
        resourceType: 'billing_service_clients',
        metadata: expect.objectContaining({ actorSubject: 'administrator' }),
      }),
    );
  });

  it('applies new organization and URL restrictions on the next request without restart', async () => {
    const f = fixture();
    await expect(
      f.policy.assertContext(actor, 'balanz_cfdi', otherOrganizationId),
    ).resolves.toBeUndefined();
    await f.service.save(actor.clientId, f.dto, 'administrator');
    await expect(
      f.policy.assertContext(actor, 'balanz_cfdi', otherOrganizationId),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      f.policy.assertContext(actor, 'balanz_cfdi', organizationId),
    ).resolves.toBeUndefined();
    await expect(
      f.policy.assertReturnUrls(
        actor,
        'https://old.test/ok',
        'https://old.test/cancel',
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      f.policy.assertReturnUrls(
        actor,
        'https://balanz.test/ok',
        'https://balanz.test/cancel',
      ),
    ).resolves.toBeUndefined();
    const authorization = await f.policy.resolve(actor);
    expect(() => f.policy.assertProduct(authorization, 'other')).toThrow(
      ForbiddenException,
    );
  });

  it('disabling overrides legacy grants and persists across service instances', async () => {
    const f = fixture();
    await f.service.save(
      actor.clientId,
      { ...f.dto, enabled: false },
      'administrator',
    );
    await expect(f.policy.resolve(actor)).rejects.toThrow('disabled');
    const second = new BillingServicePolicyService(
      new ConfigService({ auth: { requiredIssuer: actor.issuer } }),
      f.registry,
    );
    await expect(second.resolve(actor)).rejects.toThrow('disabled');
  });

  it('fails closed on registry failure instead of granting environment permissions', async () => {
    const f = fixture();
    f.clients.findOne.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(f.policy.resolve(actor)).rejects.toThrow(
      'Database unavailable',
    );
    expect(f.clients.findOne).toHaveBeenCalledTimes(1);
  });

  it('uses the checkout transaction connection for policy validation', async () => {
    const f = fixture();
    await f.policy.assertContext(
      actor,
      'balanz_cfdi',
      organizationId,
      f.manager as never,
    );
    expect(f.manager.getRepository).toHaveBeenCalledWith(
      BillingServiceClientEntity,
    );
  });

  it.each([
    { products: ['*'] },
    { organizationScope: 'organizations', organizationIds: [] },
    { allowedReturnOrigins: ['https://balanz.test/path'] },
    { allowedReturnOrigins: ['https://*.test'] },
    { allowedReturnOrigins: ['http://localhost:5175'] },
    { allowedReturnOrigins: [] },
    {
      organizationScope: 'all_for_allowed_products',
      organizationIds: [organizationId],
    },
  ])(
    'rejects unsafe/incomplete policies before any writes: %j',
    async (change) => {
      const f = fixture();
      await expect(
        f.service.save(
          actor.clientId,
          { ...f.dto, ...change } as SaveServiceClientDto,
          'administrator',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(f.clients.upsert).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown products and invalid client IDs', async () => {
    const f = fixture();
    f.products.find.mockResolvedValue([]);
    await expect(
      f.service.save(actor.clientId, f.dto, 'administrator'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      f.service.save('bad client', f.dto, 'administrator'),
    ).rejects.toThrow(BadRequestException);
  });

  it('validates types and refuses unknown fields with the global validation contract', async () => {
    const f = fixture();
    const invalid = plainToInstance(SaveServiceClientDto, {
      ...f.dto,
      enabled: 'true',
      extra: true,
    });
    const errors = await validate(invalid, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((error) => error.property).sort()).toEqual([
      'enabled',
      'extra',
    ]);
  });
});

describe('consumer management permissions', () => {
  it('requires a console session and global permission; organization operators cannot grant access', async () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      BillingServiceClientsController,
    ) as unknown[];
    expect(guards).toEqual([BillingConsoleAuthGuard, PermissionsGuard]);
    const guard = new PermissionsGuard(
      new Reflector(),
      {} as never,
      {} as never,
    );
    const request = {
      principal: { isMachine: false },
      billingAuthorization: {
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        assignments: [
          {
            role_code: 'billing.integration_operator',
            scope: {
              type: 'organizations',
              organization_ids: [organizationId],
            },
            valid_from: 1,
            expires_at: null,
          },
        ],
      },
    };
    const context = {
      getClass: () => BillingServiceClientsController,
      getHandler: () => BillingServiceClientsController.prototype.save,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(context as never)).rejects.toThrow(
      ForbiddenException,
    );
    request.billingAuthorization.assignments = [
      {
        role_code: 'billing.catalog_manager',
        scope: { type: 'catalog_global', organization_ids: [] },
        valid_from: 1,
        expires_at: null,
      },
    ];
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    request.billingAuthorization.assignments[0].scope.type = 'organizations';
    await expect(guard.canActivate(context as never)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
