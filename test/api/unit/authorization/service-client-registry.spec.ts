import type { BillingAuthorization } from '../../../../apps/api/src/modules/auth/session/billing-console-permissions';
import { policyFixture } from '../../helpers/service-policy-fixture';
import {
  BadRequestException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BillingServiceClientRegistryService } from '../../../../apps/api/src/common/services/billing-service-client-registry.service';
import { BillingServicePolicyService } from '../../../../apps/api/src/common/services/billing-service-policy.service';
import { BillingServiceClientsService } from '../../../../apps/api/src/modules/integrations/service-clients/billing-service-clients.service';
import { BillingServiceClientsController } from '../../../../apps/api/src/modules/integrations/service-clients/billing-service-clients.controller';
import { SaveServiceClientDto } from '../../../../apps/api/src/modules/integrations/dtos/save-service-client.dto';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { BillingConsoleAuthGuard } from '../../../../apps/api/src/common/guards/billing-console-auth.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BillingServiceClientEntity } from '../../../../apps/api/src/common/entities/billing-service-client.entity';

const actor = { issuer: 'https://identity.test', clientId: 'balanz-service' };
const organizationId = '63a13f20-5774-4e85-9bf1-079d83046ed5';
const otherOrganizationId = 'c36fc602-2527-4cb2-b77c-2c6cbbcb0533';
function fixture() {
  const initial = policyFixture(
    JSON.stringify({
      [actor.clientId]: {
        products: ['balanz_cfdi'],
        organizationScope: 'all_for_allowed_products',
        allowedReturnOrigins: ['https://old.test'],
      },
    }),
  );
  let row: { id: string; clientId: string; policy: unknown } | undefined = {
    id: organizationId,
    clientId: actor.clientId,
    policy: initial[actor.clientId],
  };
  const clients = {
    find: jest.fn(() => Promise.resolve(row ? [row] : [])),
    findOne: jest.fn(() => Promise.resolve(row)),
    findOneByOrFail: jest.fn(() => Promise.resolve(row!)),
    upsert: jest.fn((input: { clientId: string; policy: unknown }) => {
      row = { id: organizationId, ...input };
      return Promise.resolve();
    }),
    manager: { transaction: jest.fn() },
  };
  const manager = {
    getRepository: jest.fn(() => clients),
    query: jest.fn().mockResolvedValue([]),
  };
  clients.manager.transaction.mockImplementation(
    (callback: (value: typeof manager) => Promise<unknown>) =>
      callback(manager),
  );
  const products = {
    find: jest.fn(() => Promise.resolve([{ code: 'balanz_cfdi' }])),
  };
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const config = new ConfigService({
    app: { nodeEnv: 'production' },
    auth: { requiredIssuer: actor.issuer, storedPolicies: initial },
  });
  const registry = new BillingServiceClientRegistryService(clients as never);
  const policy = new BillingServicePolicyService(config, registry);
  const identity = {
    billingScopes: jest
      .fn()
      .mockResolvedValue(['billing.integration.checkout.create']),
  };
  const service = new BillingServiceClientsService(
    clients as never,
    products as never,
    config,
    audit as never,
    identity as never,
  );
  const dto: SaveServiceClientDto = {
    enabled: true,
    products: ['balanz_cfdi'],
    organizationScope: 'organizations',
    organizationIds: [organizationId],
    allowedReturnOrigins: ['https://balanz.test'],
  };
  return {
    clients,
    config,
    manager,
    audit,
    registry,
    service,
    policy,
    dto,
    products,
    identity,
  };
}

describe('consumer registry and live authorization', () => {
  it('lists only stored clients without writing and updates their policies', async () => {
    const f = fixture();
    expect(await f.service.list()).toEqual([
      expect.objectContaining({
        clientId: actor.clientId,
        source: 'database',
      }),
    ]);
    expect(f.clients.upsert).not.toHaveBeenCalled();
    const saved = await f.service.save(actor.clientId, f.dto, 'administrator');
    expect(await f.service.list()).toEqual([saved]);
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        manager: f.manager,
        resourceType: 'billing_service_clients',
        metadata: expect.objectContaining({
          actorSubject: 'administrator',
        }) as Record<string, unknown>,
      }),
    );
  });

  it('saves global policy after HTTP DTO transformation, retaining local return origins only in development', async () => {
    const f = fixture();
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const dto = (await pipe.transform(
      {
        enabled: true,
        products: ['balanz_cfdi'],
        organizationScope: 'all_for_allowed_products',
        allowedReturnOrigins: ['http://localhost:5181'],
      },
      { type: 'body', metatype: SaveServiceClientDto },
    )) as SaveServiceClientDto;
    f.config.set('app.nodeEnv', 'development');
    await expect(
      f.service.save(actor.clientId, dto, 'administrator'),
    ).resolves.toMatchObject({
      organizationScope: 'all_for_allowed_products',
      allowedReturnOrigins: ['http://localhost:5181'],
    });
    f.clients.upsert.mockClear();
    f.config.set('app.nodeEnv', 'production');
    await expect(
      f.service.save(actor.clientId, dto, 'administrator'),
    ).rejects.toThrow('HTTPS en producción');
    expect(f.clients.upsert).not.toHaveBeenCalled();
    await expect(
      f.service.save(
        actor.clientId,
        { ...dto, organizationIds: [] },
        'administrator',
      ),
    ).rejects.toThrow('Política inválida');
    expect(f.clients.upsert).not.toHaveBeenCalled();
  });

  it('allows a read-only client without return origins but rejects checkout without them', async () => {
    const f = fixture();
    f.identity.billingScopes.mockResolvedValue([
      'billing.integration.catalog.read',
    ]);
    await expect(
      f.service.save(
        actor.clientId,
        { ...f.dto, allowedReturnOrigins: [] },
        'administrator',
      ),
    ).resolves.toMatchObject({ allowedReturnOrigins: [] });
    f.identity.billingScopes.mockResolvedValue([
      'billing.integration.checkout.create',
    ]);
    await expect(
      f.service.save(
        actor.clientId,
        { ...f.dto, allowedReturnOrigins: [] },
        'administrator',
      ),
    ).rejects.toThrow(BadRequestException);
  });
  it('allows catalog-only access with no organizations and still denies every organization at runtime', async () => {
    const f = fixture();
    f.identity.billingScopes.mockResolvedValue([
      'billing.integration.catalog.read',
    ]);
    const dto = { ...f.dto, organizationIds: [], allowedReturnOrigins: [] };
    expect(
      await validate(plainToInstance(SaveServiceClientDto, dto)),
    ).toHaveLength(0);
    await expect(
      f.service.save(actor.clientId, dto, 'administrator'),
    ).resolves.toMatchObject({
      organizationScope: 'organizations',
      organizationIds: [],
    });
    const authorization = await f.policy.resolve(actor);
    expect(() =>
      f.policy.assertProduct(authorization, 'balanz_cfdi'),
    ).not.toThrow();
    expect(() =>
      f.policy.assertOrganization(authorization, organizationId),
    ).toThrow(ForbiddenException);
    await expect(
      f.policy.assertContext(actor, 'balanz_cfdi', otherOrganizationId),
    ).rejects.toThrow(ForbiddenException);
  });
  it.each([
    'billing.integration.checkout.create',
    'billing.integration.checkout.read',
    'billing.integration.licenses.read',
  ])(
    'requires explicit organization access for %s and accepts explicit global product scope',
    async (scope) => {
      const f = fixture();
      f.identity.billingScopes.mockResolvedValue([
        'billing.integration.catalog.read',
        scope,
      ]);
      await expect(
        f.service.save(
          actor.clientId,
          { ...f.dto, organizationIds: [] },
          'administrator',
        ),
      ).rejects.toThrow('Selecciona organizaciones');
      expect(f.clients.upsert).not.toHaveBeenCalled();
      const { organizationIds: omitted, ...global } = f.dto;
      void omitted;
      await expect(
        f.service.save(
          actor.clientId,
          { ...global, organizationScope: 'all_for_allowed_products' },
          'administrator',
        ),
      ).resolves.toMatchObject({
        organizationScope: 'all_for_allowed_products',
      });
    },
  );
  it('does not save a client without effective Billing grants', async () => {
    const f = fixture();
    f.identity.billingScopes.mockResolvedValue([]);
    await expect(
      f.service.save(actor.clientId, f.dto, 'administrator'),
    ).rejects.toThrow(BadRequestException);
    expect(f.clients.upsert).not.toHaveBeenCalled();
  });
  it('can disable a client even while Identity is unavailable', async () => {
    const f = fixture();
    f.identity.billingScopes.mockRejectedValue(new Error('unavailable'));
    await expect(
      f.service.save(
        actor.clientId,
        { ...f.dto, enabled: false },
        'administrator',
      ),
    ).resolves.toMatchObject({ enabled: false });
    expect(f.identity.billingScopes).not.toHaveBeenCalled();
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

  it('disabling revokes stored grants and persists across service instances', async () => {
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

  it('fails closed on registry failure without granting access', async () => {
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

describe('authenticated-mode consumer policy isolation', () => {
  const authorization = (): BillingAuthorization => ({
    assignments: [],
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    mode: 'authenticated',
    organizationId,
  });
  it('lists only policies exclusively owned by the selected organization', async () => {
    const f = fixture();
    const { organizationIds: omitted, ...global } = f.dto;
    void omitted;
    f.clients.find.mockResolvedValue([
      { id: 'own', clientId: 'own', policy: f.dto },
      {
        id: 'foreign',
        clientId: 'foreign',
        policy: { ...f.dto, organizationIds: [otherOrganizationId] },
      },
      {
        id: 'shared',
        clientId: 'shared',
        policy: {
          ...f.dto,
          organizationIds: [organizationId, otherOrganizationId],
        },
      },
      {
        id: 'global',
        clientId: 'global',
        policy: { ...global, organizationScope: 'all_for_allowed_products' },
      },
      {
        id: 'unbound',
        clientId: 'unbound',
        policy: { ...f.dto, organizationIds: [] },
      },
    ]);
    expect(
      (await f.service.list(authorization())).map((policy) => policy.clientId),
    ).toEqual(['own']);
    expect(await f.service.list()).toHaveLength(5);
    expect(f.clients.upsert).not.toHaveBeenCalled();
  });
  it.each(['global', 'foreign', 'shared', 'empty'] as const)(
    'rejects a new %s policy before querying Identity or writing',
    async (scope) => {
      const f = fixture();
      const dto: SaveServiceClientDto =
        scope === 'global'
          ? {
              ...f.dto,
              organizationScope: 'all_for_allowed_products',
              organizationIds: undefined,
            }
          : {
              ...f.dto,
              organizationIds:
                scope === 'empty'
                  ? []
                  : scope === 'shared'
                    ? [organizationId, otherOrganizationId]
                    : [otherOrganizationId],
            };
      await expect(
        f.service.save(
          actor.clientId,
          dto,
          'member',
          undefined,
          authorization(),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(f.identity.billingScopes).not.toHaveBeenCalled();
      expect(f.clients.upsert).not.toHaveBeenCalled();
    },
  );
  it.each(['global', 'foreign', 'shared'] as const)(
    'cannot take over an existing %s policy by rewriting its scope to the selected organization',
    async (scope) => {
      const f = fixture();
      const { organizationIds: omitted, ...global } = f.dto;
      void omitted;
      const previous =
        scope === 'global'
          ? { ...global, organizationScope: 'all_for_allowed_products' }
          : {
              ...f.dto,
              organizationIds:
                scope === 'shared'
                  ? [organizationId, otherOrganizationId]
                  : [otherOrganizationId],
            };
      f.clients.findOne.mockResolvedValue({
        id: organizationId,
        clientId: actor.clientId,
        policy: previous,
      });
      await expect(
        f.service.save(
          actor.clientId,
          f.dto,
          'member',
          undefined,
          authorization(),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(f.manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        ['billing-service-client:' + actor.clientId],
      );
      expect(f.clients.upsert).not.toHaveBeenCalled();
      expect(f.audit.record).not.toHaveBeenCalled();
    },
  );
  it('updates its own existing policy only after acquiring the per-client transaction lock', async () => {
    const f = fixture();
    f.clients.findOne.mockResolvedValue({
      id: organizationId,
      clientId: actor.clientId,
      policy: f.dto,
    });
    await expect(
      f.service.save(
        actor.clientId,
        f.dto,
        'member',
        undefined,
        authorization(),
      ),
    ).resolves.toMatchObject({
      organizationScope: 'organizations',
      organizationIds: [organizationId],
    });
    expect(f.manager.query.mock.invocationCallOrder[0]).toBeLessThan(
      f.clients.findOne.mock.invocationCallOrder[0],
    );
    expect(f.clients.upsert).toHaveBeenCalledTimes(1);
  });
  it('refuses expired or unbound authorization before disclosing policies', async () => {
    const f = fixture();
    await expect(
      f.service.list({ ...authorization(), expiresAt: 1 }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      f.service.list({ ...authorization(), organizationId: undefined }),
    ).rejects.toThrow(ForbiddenException);
    expect(f.clients.find).not.toHaveBeenCalled();
  });
  it('forwards the verified human authorization instead of only the subject', () => {
    const f = fixture();
    const service = { list: jest.fn(), save: jest.fn() };
    const controller = new BillingServiceClientsController(service as never);
    const auth = authorization();
    const request = {
      principal: { sub: 'member' },
      billingAuthorization: auth,
    };
    controller.list(request as never);
    controller.save(actor.clientId, f.dto, request as never);
    expect(service.list).toHaveBeenCalledWith(auth);
    expect(service.save).toHaveBeenCalledWith(
      actor.clientId,
      f.dto,
      'member',
      undefined,
      auth,
    );
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
      getHandler: () =>
        Reflect.get(BillingServiceClientsController.prototype, 'save'),
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
