import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { BillingIntegrationAdminGuard } from '../../../../apps/api/src/modules/integrations/billing-integration-admin.guard';
import { BillingIntegrationAdminService } from '../../../../apps/api/src/modules/integrations/billing-integration-admin.service';
import { BillingIdentityOAuthClientsService } from '../../../../apps/api/src/modules/integrations/oauth-clients/billing-identity-oauth-clients.service';

const actor = '10000000-0000-4000-8000-000000000001';
describe('delegated integration administration', () => {
  function fixture(principal: Record<string, unknown>, subject = actor) {
    const request = { principal, header: () => subject };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => Object,
      getClass: () => Object,
    } as unknown as ExecutionContext;
    const bearer = { canActivate: jest.fn().mockResolvedValue(true) };
    const reflector = {
      getAllAndOverride: () => ['billing.integrations.manage'],
    } as unknown as Reflector;
    return {
      guard: new BillingIntegrationAdminGuard(bearer as never, reflector),
      context,
      bearer,
    };
  }
  it('requires a verified service, exact admin scope and operator subject', async () => {
    for (const principal of [
      {
        isMachine: false,
        clientId: 'console',
        scopes: ['billing.integrations.manage'],
      },
      {
        isMachine: true,
        clientId: 'console',
        scopes: ['billing.integration.checkout.create'],
      },
      { isMachine: true, scopes: ['billing.integrations.manage'] },
    ]) {
      const f = fixture(principal);
      await expect(f.guard.canActivate(f.context)).rejects.toThrow(
        ForbiddenException,
      );
      expect(f.bearer.canActivate).toHaveBeenCalled();
    }
    const f = fixture(
      {
        isMachine: true,
        clientId: 'console',
        scopes: ['billing.integrations.manage'],
      },
      '',
    );
    await expect(f.guard.canActivate(f.context)).rejects.toThrow(
      ForbiddenException,
    );
    const valid = fixture({
      isMachine: true,
      clientId: 'console',
      scopes: ['billing.integrations.manage'],
    });
    await expect(valid.guard.canActivate(valid.context)).resolves.toBe(true);
  });
});
describe('receiver registration', () => {
  function fixture() {
    const query = jest.fn().mockResolvedValue([{ id: actor }]);
    const manager = { query };
    const db = {
      query,
      transaction: jest.fn((fn: (m: unknown) => unknown) => fn(manager)),
    };
    const identity = {
      assertDestination: jest.fn().mockResolvedValue(undefined),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new BillingIntegrationAdminService(
      db as never,
      new ConfigService({
        app: { nodeEnv: 'production' },
        hemiaLegal: { clientId: 'billing-service' },
      }),
      identity as never,
      {} as never,
      audit as never,
      {} as never,
    );
    return { service, db, identity, audit };
  }
  const receiver = {
    url: 'https://consumer.example/license',
    resource: 'https://consumer.example',
    audience: 'consumer-api',
    enabled: true,
  };
  it('validates the exact Identity destination before writing and audits both actors', async () => {
    const f = fixture();
    await expect(
      f.service.saveReceiver('another-product', receiver, actor, 'console'),
    ).resolves.toEqual({ productCode: 'another-product', ...receiver });
    expect(f.identity.assertDestination).toHaveBeenCalledWith(
      'billing-service',
      receiver,
      'billing.webhooks.deliver',
    );
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          actorSubject: actor,
          actorClientId: 'console',
        }) as Record<string, unknown>,
      }),
    );
  });
  it('does not persist an unauthorized or cross-origin destination', async () => {
    const f = fixture();
    f.identity.assertDestination.mockRejectedValue(new Error('not authorized'));
    await expect(
      f.service.saveReceiver('product', receiver, actor, 'console'),
    ).rejects.toThrow('not authorized');
    expect(f.db.transaction).not.toHaveBeenCalled();
    await expect(
      f.service.saveReceiver(
        'product',
        { ...receiver, resource: 'https://other.example' },
        actor,
        'console',
      ),
    ).rejects.toThrow('origen');
    expect(f.db.transaction).not.toHaveBeenCalled();
  });
});
describe('effective Billing destinations', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });
  it('uses destination grants instead of unrelated default scopes', async () => {
    const client = {
      clientId: 'consumer',
      type: 'confidential',
      status: 'active',
      audience: 'identity-api',
      grantTypes: ['client_credentials'],
      scopes: ['billing.integration.checkout.create'],
      serviceDestinations: [
        {
          resource: 'https://billing.example',
          audience: 'billing-api',
          scopes: ['billing.integration.catalog.read'],
        },
      ],
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'test',
            token_type: 'Bearer',
            expires_in: 120,
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([client]))) as never;
    const service = new BillingIdentityOAuthClientsService(
      new ConfigService({
        auth: { audience: 'billing-api' },
        app: { nodeEnv: 'test' },
        sso: {
          tokenUrl: 'https://identity.example/oauth/token',
          clientId: 'billing',
          clientSecret: 'test-only',
        },
      }),
    );
    await expect(service.billingScopes('consumer')).resolves.toEqual([
      'billing.integration.catalog.read',
    ]);
  });
});

it('does not restore default scopes when Identity explicitly denies all destinations', async () => {
  const service = new BillingIdentityOAuthClientsService(
    new ConfigService({ auth: { audience: 'billing-api' } }),
  );
  jest.spyOn(service, 'listServiceClients').mockResolvedValue([
    {
      clientId: 'consumer',
      audience: 'billing-api',
      grantTypes: ['client_credentials'],
      scopes: ['billing.integration.checkout.create'],
      serviceDestinations: [],
    },
  ]);
  await expect(service.billingScopes('consumer')).resolves.toEqual([]);
  await expect(
    service.assertDestination(
      'consumer',
      { resource: 'https://billing.example', audience: 'billing-api' },
      'billing.integration.checkout.create',
    ),
  ).rejects.toThrow();
});
