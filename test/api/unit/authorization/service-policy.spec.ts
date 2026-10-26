import { BillingPaymentAttemptsController } from '../../../../apps/api/src/modules/payment-attempts/billing-payment-attempts.controller';
import { BillingSnapshotsController } from '../../../../apps/api/src/modules/licenses/billing-snapshots.controller';
import {
  policyFixture,
  policyRegistry,
} from '../../helpers/service-policy-fixture';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { In } from 'typeorm';
import {
  BILLING_SERVICE_ACCESS,
  BillingServiceAccess,
  BillingServiceAccessRule,
  BillingServiceResource,
} from '../../../../apps/api/src/common/decorators/billing-service-access.decorator';
import { BillingInternalAuthGuard } from '../../../../apps/api/src/common/guards/billing-internal-auth.guard';
import { BillingServicePolicyGuard } from '../../../../apps/api/src/common/guards/billing-service-policy.guard';
import { BillingResourceContextRepository } from '../../../../apps/api/src/common/repositories/billing-resource-context.repository';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { BillingServicePolicyService } from '../../../../apps/api/src/common/services/billing-service-policy.service';
import { BillingCatalogInternalController } from '../../../../apps/api/src/modules/catalog/controllers/billing-catalog-internal.controller';
import { BillingCatalogPublicController } from '../../../../apps/api/src/modules/catalog/controllers/billing-catalog-public.controller';
import { BillingCatalogService } from '../../../../apps/api/src/modules/catalog/billing-catalog.service';
import { BillingCheckoutController } from '../../../../apps/api/src/modules/checkout/billing-checkout.controller';
import { BillingIntegrationsController } from '../../../../apps/api/src/modules/integrations/billing-integrations.controller';
import { BillingInvoicesController } from '../../../../apps/api/src/modules/invoices/controllers/billing-invoices.controller';
import { BillingInvoicesService } from '../../../../apps/api/src/modules/invoices/billing-invoices.service';
import { BillingLicensesController } from '../../../../apps/api/src/modules/licenses/billing-licenses.controller';
import { BillingSubscriptionAddonsController } from '../../../../apps/api/src/modules/subscription-addons/controllers/billing-subscription-addons.controller';
import { BillingSubscriptionsManagementController } from '../../../../apps/api/src/modules/subscriptions-management/billing-subscriptions-management.controller';

const actor = { issuer: 'https://identity.test', clientId: 'medsync-service' };
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const id = randomUUID();

function fixture(rule?: BillingServiceAccessRule) {
  const clients = policyFixture(
    JSON.stringify({
      [actor.clientId]: {
        products: ['medsync'],
        organizationScope: 'organizations',
        organizationIds: [organizationId],
      },
    }),
  );
  const policy = new BillingServicePolicyService(
    new ConfigService({
      auth: { requiredIssuer: actor.issuer, storedPolicies: clients },
    }),
    policyRegistry(
      new ConfigService({
        auth: { requiredIssuer: actor.issuer, storedPolicies: clients },
      }),
    ),
  );
  const request = {
    billingServiceAuthorization: { ...actor, policy: clients[actor.clientId] },
    params: { id },
    body: {} as Record<string, unknown>,
    query: {} as Record<string, unknown>,
  };
  const rows = [
    {
      productCode: 'medsync',
      organizationId,
      metadata: {
        createdByIssuer: actor.issuer,
        createdByClientId: actor.clientId,
      },
    },
  ];
  const database = { query: jest.fn(() => Promise.resolve(rows)) };
  const handler = () => undefined;
  if (rule) BillingServiceAccess(rule)(handler);
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getClass: () => Object,
    getHandler: () => handler,
  } as unknown as ExecutionContext;
  const guard = new BillingServicePolicyGuard(
    new Reflector(),
    new BillingResourceContextRepository(database as never),
    policy,
  );
  return { clients, policy, request, rows, database, context, guard };
}

describe('service policy configuration', () => {
  it('compares UUID organization casing without granting another organization', async () => {
    const f = fixture();
    await expect(
      f.policy.assertContext(actor, 'medsync', organizationId.toUpperCase()),
    ).resolves.toBeUndefined();
    await expect(
      f.policy.assertContext(
        actor,
        'medsync',
        otherOrganizationId.toUpperCase(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('denies checkout return origins when no allowlist is configured', async () => {
    const f = fixture();
    await expect(
      f.policy.assertReturnUrls(
        actor,
        'https://medsync.test/success',
        'https://medsync.test/cancel',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each([
    'https://*.hemia.test',
    'https://medsync.test/path',
    'https://medsync.test?next=other',
    'https://medsync.test#fragment',
    'https://user:pass@medsync.test',
    'http://medsync.test',
    'ftp://medsync.test',
    'medsync.test',
  ])('rejects an invalid configured return origin: %s', (origin) => {
    expect(() =>
      policyFixture(
        JSON.stringify({
          service: {
            products: ['medsync'],
            organizationScope: 'all_for_allowed_products',
            allowedReturnOrigins: [origin],
          },
        }),
      ),
    ).toThrow('Invalid Billing service policies');
  });

  it('normalizes configured origins and matches protocol, host and port exactly', async () => {
    const f = fixture();
    const clients = policyFixture(
      JSON.stringify({
        [actor.clientId]: {
          products: ['medsync'],
          organizationScope: 'all_for_allowed_products',
          allowedReturnOrigins: [
            'https://MEDSYNC.test:443/',
            'https://medsync.test:8443',
          ],
        },
      }),
    );
    const policy = new BillingServicePolicyService(
      new ConfigService({
        auth: { requiredIssuer: actor.issuer, storedPolicies: clients },
        app: { nodeEnv: 'production' },
      }),
      policyRegistry(
        new ConfigService({
          auth: { requiredIssuer: actor.issuer, storedPolicies: clients },
          app: { nodeEnv: 'production' },
        }),
      ),
    );
    expect(clients[actor.clientId].allowedReturnOrigins).toEqual([
      'https://medsync.test',
      'https://medsync.test:8443',
    ]);
    await expect(
      policy.assertReturnUrls(
        actor,
        'https://medsync.test/success?checkout=1',
        'https://medsync.test:8443/cancel',
      ),
    ).resolves.toBeUndefined();
    for (const url of [
      'https://other.test/cancel',
      'https://medsync.test.evil.test/cancel',
      'https://sub.medsync.test/cancel',
      'https://medsync.test:9443/cancel',
    ]) {
      await expect(
        policy.assertReturnUrls(actor, 'https://medsync.test/success', url),
      ).rejects.toThrow(ForbiddenException);
    }
    f.clients[actor.clientId].allowedReturnOrigins = ['https://other.test'];
    await expect(
      f.policy.assertReturnUrls(
        actor,
        'https://medsync.test/success',
        'https://medsync.test/cancel',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(['production', undefined, 'development', 'test'])(
    'restricts registered HTTP loopback origins for environment %s',
    async (nodeEnv) => {
      const f = fixture();
      f.clients[actor.clientId].allowedReturnOrigins = [
        'http://localhost:5175',
        'http://127.0.0.1:5175',
        'http://[::1]:5175',
      ];
      const policy = new BillingServicePolicyService(
        new ConfigService({
          auth: { requiredIssuer: actor.issuer, storedPolicies: f.clients },
          app: { nodeEnv },
        }),
        policyRegistry(
          new ConfigService({
            auth: { requiredIssuer: actor.issuer, storedPolicies: f.clients },
            app: { nodeEnv },
          }),
        ),
      );
      for (const origin of f.clients[actor.clientId].allowedReturnOrigins) {
        const check = () =>
          policy.assertReturnUrls(
            actor,
            `${origin}/success`,
            `${origin}/cancel`,
          );
        if (nodeEnv === 'development' || nodeEnv === 'test')
          await expect(check()).resolves.toBeUndefined();
        else await expect(check()).rejects.toThrow(BadRequestException);
      }
      await expect(
        policy.assertReturnUrls(
          actor,
          'http://localhost:9999/success',
          'http://localhost:5175/cancel',
        ),
      ).rejects.toThrow(
        nodeEnv === 'development' || nodeEnv === 'test'
          ? ForbiddenException
          : BadRequestException,
      );
    },
  );

  it('requires a configured issuer even for a registered client', async () => {
    const f = fixture();
    const policy = new BillingServicePolicyService(
      new ConfigService({ auth: { storedPolicies: f.clients } }),
      policyRegistry(
        new ConfigService({ auth: { storedPolicies: f.clients } }),
      ),
    );
    await expect(
      policy.resolve({ ...actor, issuer: undefined } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it('defaults to denying every client and rejects unknown issuers', async () => {
    const policy = new BillingServicePolicyService(
      new ConfigService({ auth: { requiredIssuer: actor.issuer } }),
      policyRegistry(
        new ConfigService({ auth: { requiredIssuer: actor.issuer } }),
      ),
    );
    await expect(policy.resolve(actor)).rejects.toThrow(ForbiddenException);
    const f = fixture();
    await expect(
      f.policy.resolve({ ...actor, issuer: 'https://other.test' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      f.policy.resolve({ ...actor, clientId: '__proto__' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each([
    'not-json',
    '[]',
    'null',
    JSON.stringify({ service: { products: ['medsync'] } }),
    JSON.stringify({
      service: { products: [], organizationScope: 'all_for_allowed_products' },
    }),
    JSON.stringify({
      service: {
        products: ['medsync'],
        organizationScope: 'organizations',
        organizationIds: ['invalid'],
      },
    }),
    JSON.stringify({
      service: {
        products: ['medsync'],
        organizationScope: 'all_for_allowed_products',
        allowSharedCheckouts: 'true',
      },
    }),
    JSON.stringify({
      service: {
        products: ['medsync'],
        organizationScope: 'all_for_allowed_products',
        unknown: true,
      },
    }),
  ])('rejects malformed stored policies: %s', (value) => {
    expect(() => policyFixture(value)).toThrow(
      'Invalid Billing service policies',
    );
  });

  it('requires an explicit global grant and does not infer it from scopes', async () => {
    const f = fixture();
    const auth = await f.policy.resolve(actor);
    expect(() => f.policy.assertProduct(auth, 'other')).toThrow(
      ForbiddenException,
    );
    expect(() =>
      f.policy.assertOrganization(auth, otherOrganizationId),
    ).toThrow(ForbiddenException);
    f.clients[actor.clientId] = policyFixture(
      JSON.stringify({
        global: {
          products: ['*'],
          organizationScope: 'all_for_allowed_products',
        },
      }),
    ).global;
    await expect(
      f.policy.assertContext(actor, 'other', otherOrganizationId),
    ).resolves.toBeUndefined();
  });
});

describe('service route authorization', () => {
  it('fails closed when a service route omits its resource policy', async () => {
    const f = fixture();
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('does not let a wildcard scope bypass the resource policy', async () => {
    const f = fixture({
      product: 'productCode',
      organization: 'organizationId',
      source: 'body',
    });
    Object.assign(f.request, {
      principal: {
        ...actor,
        sub: actor.clientId,
        isMachine: true,
        scopes: ['*.*'],
      },
    });
    f.request.body = {
      productCode: 'medsync',
      organizationId: otherOrganizationId,
    };
    const guard = new PermissionsGuard(
      {
        getAllAndOverride: () => ['billing.integration.checkout.create'],
      } as never,
      f.database as never,
      f.guard,
    );
    await expect(guard.canActivate(f.context)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects explicit scope omissions even when the client has broad resource access', async () => {
    const f = fixture('catalog');
    const guard = new PermissionsGuard(
      { getAllAndOverride: () => [] } as never,
      f.database as never,
      f.guard,
    );
    await expect(guard.canActivate(f.context)).rejects.toMatchObject({
      status: 403,
    });
  });

  it.each([
    'subscriptions',
    'subscription_addons',
    'payments',
    'invoices',
  ] as BillingServiceResource[])(
    'uses stored ownership for %s, hiding out-of-scope resources',
    async (resource) => {
      const f = fixture({ resource });
      f.rows[0].organizationId = otherOrganizationId;
      f.request.body = { organizationId, productCode: 'medsync' };
      f.request.query = { organization_id: organizationId };
      await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
        status: 404,
      });
      expect(f.database.query.mock.calls[0]).toEqual([
        expect.any(String),
        [id],
      ]);
      f.rows[0].organizationId = organizationId;
      f.rows[0].productCode = 'other';
      await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
        status: 404,
      });
    },
  );

  it('requires the checkout creator in addition to product and organization scope', async () => {
    const f = fixture({ resource: 'checkout_sessions' });
    f.rows[0].metadata.createdByClientId = 'another-service';
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 404,
    });
    f.clients[actor.clientId].allowSharedCheckouts = true;
    await expect(f.guard.canActivate(f.context)).resolves.toBe(true);
    f.rows[0].organizationId = otherOrganizationId;
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('checks both the stored product and a catalog change destination', async () => {
    const f = fixture({ resource: 'plans' });
    f.request.body.productCode = 'other';
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 403,
    });
    f.request.body = { productCode: 'medsync' };
    f.rows[0].productCode = 'other';
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('requires explicit global product access for an unlinked payment', async () => {
    const f = fixture({ resource: 'payments' });
    Object.assign(f.rows[0], { productCode: null });
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 404,
    });
    f.clients[actor.clientId].products = ['*'];
    await expect(f.guard.canActivate(f.context)).resolves.toBe(true);
    f.rows[0].organizationId = otherOrganizationId;
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('validates invoice list filters against the stored payment and organization', async () => {
    const f = fixture('invoice-list');
    f.request.query.organization_id = otherOrganizationId;
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 403,
    });
    f.request.query = { organization_id: organizationId, payment_id: id };
    f.rows[0].productCode = 'other';
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('requires a policy on every protected route, including compatibility endpoints', () => {
    const controllers = [
      BillingIntegrationsController,
      BillingPaymentAttemptsController,
      BillingSnapshotsController,
      BillingCheckoutController,
      BillingCatalogInternalController,
      BillingCatalogPublicController,
      BillingInvoicesController,
      BillingLicensesController,
      BillingSubscriptionAddonsController,
      BillingSubscriptionsManagementController,
    ];
    const reflector = new Reflector();
    const checked: string[] = [];
    for (const controller of controllers) {
      for (const [name, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(controller.prototype),
      )) {
        const handler = descriptor.value as
          ((...args: unknown[]) => unknown) | undefined;
        if (!handler || !Reflect.hasMetadata(METHOD_METADATA, handler))
          continue;
        const guards = [
          ...(reflector.get<unknown[]>(GUARDS_METADATA, controller) ?? []),
          ...(reflector.get<unknown[]>(GUARDS_METADATA, handler) ?? []),
        ];
        if (!guards.includes(BillingInternalAuthGuard)) continue;
        expect(
          reflector.getAllAndOverride(BILLING_SERVICE_ACCESS, [
            handler,
            controller,
          ]),
        ).toBeDefined();
        expect(guards).toContain(PermissionsGuard);
        checked.push(`${controller.name}.${name}`);
      }
    }
    expect(checked).toContain('BillingSubscriptionsManagementController.quote');
    expect(checked).toContain('BillingIntegrationsController.compatibility');
    expect(checked.length).toBe(37);
  });
});

describe('service list filtering in database queries', () => {
  it('restricts product queries before fetching catalog results', async () => {
    const products = { find: jest.fn(() => Promise.resolve([])) };
    const service = new BillingCatalogService(
      products as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.listActiveProducts(['medsync']);
    expect(products.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'active', code: In(['medsync']) },
      }),
    );
    await service.listActiveProducts(['*']);
    expect(products.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { status: 'active' } }),
    );
  });

  it('restricts invoice product and organization scope before fetching results', async () => {
    const builder = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => Promise.resolve([])),
    };
    const invoices = { createQueryBuilder: jest.fn(() => builder) };
    const service = new BillingInvoicesService(
      invoices as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const f = fixture();
    await service.listInvoices({}, await f.policy.resolve(actor));
    expect(builder.leftJoin).toHaveBeenCalledWith(
      'payment.subscription',
      'subscription',
    );
    expect(builder.andWhere.mock.calls).toEqual([
      [
        'subscription.product_code IN (:...serviceProducts)',
        { serviceProducts: ['medsync'] },
      ],
      [
        'invoice.organization_id IN (:...serviceOrganizations)',
        { serviceOrganizations: [organizationId] },
      ],
    ]);
    expect(builder.getMany).toHaveBeenCalledTimes(1);
  });
});
