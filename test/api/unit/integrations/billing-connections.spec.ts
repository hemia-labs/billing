import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { BillingConnectionsService } from '../../../../apps/api/src/modules/integrations/billing-connections.service';
import {
  BillingConnectionsController,
  BillingConnectionsV2Controller,
} from '../../../../apps/api/src/modules/integrations/billing-connections.controller';
import {
  ConnectionDiscoveryController,
  ConnectionDiscoveryV2Controller,
} from '../../../../apps/api/src/modules/integrations/connection-discovery.controller';
import { BillingInternalAuthGuard } from '../../../../apps/api/src/common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { BillingServicePolicyGuard } from '../../../../apps/api/src/common/guards/billing-service-policy.guard';
import { PERMISSIONS_KEY } from '../../../../apps/api/src/common/decorators/permissions.decorator';
import {
  billingConnectionConfiguration,
  parseBillingServicePolicy,
} from '../../../../apps/api/src/common/types/billing-service-policy';
import type { AuthenticatedRequest } from '../../../../apps/api/src/common/types/authenticated-request.type';

function fixture() {
  const configuration = {
    issuer: 'https://identity.test',
    tokenUrl: 'https://identity.test/oauth/token',
    clientId: 'application',
    baseUrl: 'https://billing.test/api/v1',
    resource: 'https://billing.test',
    audience: 'billing-api',
    productCode: 'product',
    receiver: { audience: 'application-api' },
    legal: {
      baseUrl: 'https://legal.test',
      resource: 'https://legal.test',
      audience: 'legal-api',
      verificationClientId: 'legal-service',
    },
  };
  const policy = parseBillingServicePolicy({
    enabled: true,
    products: ['product'],
    organizationScope: 'organizations',
    organizationIds: [],
    allowedReturnOrigins: [],
    connections: { application: { version: 1, configuration } },
  });
  const config = new ConfigService({
    app: { nodeEnv: 'production', globalPrefix: 'api/v1' },
    auth: { requiredIssuer: configuration.issuer, audience: 'billing-api' },
    sso: {
      tokenUrl: configuration.tokenUrl,
      redirectUri: 'https://billing.test/auth/callback',
    },
  });
  const request = {
    principal: {
      isMachine: true,
      clientId: 'application',
      issuer: configuration.issuer,
    },
    billingServiceAuthorization: {
      clientId: 'application',
      issuer: configuration.issuer,
      policy,
    },
  } as AuthenticatedRequest;
  const authorization = {
    assertProduct: jest.fn(
      (actor: { policy: typeof policy }, product: string) => {
        if (!actor.policy.products.includes(product))
          throw new ForbiddenException();
      },
    ),
  };
  const products = {
    findOne: jest.fn().mockResolvedValue({ id: 'product-id' }),
  };
  const service = new BillingConnectionsService(
    config,
    authorization as never,
    products as never,
  );
  return {
    configuration,
    config,
    policy,
    request,
    authorization,
    products,
    service,
  };
}

describe('published OAuth connections', () => {
  it('publishes only generic discovery and resolves the verified client snapshot without writes', async () => {
    const f = fixture();
    expect(f.service.discovery()).toEqual({
      contract: 'hemia.payments.connections.v1',
      issuer: f.configuration.issuer,
      tokenUrl: f.configuration.tokenUrl,
      audience: 'billing-api',
      resource: 'https://billing.test',
      scope: 'billing.integration.catalog.read',
      configurationPath:
        '/api/v1/billing/integrations/v1/connections/{connectionCode}',
    });
    expect(await f.service.resolve(f.request, 'application')).toEqual({
      contract: 'hemia.payments.connection.v1',
      connectionCode: 'application',
      version: 1,
      configuration: f.configuration,
    });
    expect(f.authorization.assertProduct).toHaveBeenCalled();
    expect(f.products.findOne).toHaveBeenCalledWith({
      where: { code: 'product', status: 'active' },
      select: { id: true },
    });
  });

  it('rejects unknown connections, human identities, removed products, and disabled policies', async () => {
    const f = fixture();
    await expect(f.service.resolve(f.request, 'another-app')).rejects.toThrow(
      NotFoundException,
    );
    await expect(f.service.resolve(f.request, '__proto__')).rejects.toThrow(
      BadRequestException,
    );
    f.request.principal!.isMachine = false;
    await expect(f.service.resolve(f.request, 'application')).rejects.toThrow(
      UnauthorizedException,
    );
    f.request.principal!.isMachine = true;
    f.policy.products = ['other-product'];
    await expect(f.service.resolve(f.request, 'application')).rejects.toThrow(
      ForbiddenException,
    );
    f.policy.products = ['product'];
    f.policy.enabled = false;
    await expect(f.service.resolve(f.request, 'application')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an inactive product, another client snapshot, and a changed OAuth target', async () => {
    const f = fixture();
    f.products.findOne.mockResolvedValue(null);
    await expect(f.service.resolve(f.request, 'application')).rejects.toThrow(
      NotFoundException,
    );
    f.products.findOne.mockResolvedValue({ id: 'product-id' });
    f.policy.connections!.application.configuration.clientId = 'someone-else';
    await expect(f.service.resolve(f.request, 'application')).rejects.toThrow(
      BadRequestException,
    );
    f.policy.connections!.application.configuration.clientId = 'application';
    f.policy.connections!.application.configuration.tokenUrl =
      'https://malicious.test/token';
    await expect(f.service.resolve(f.request, 'application')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('keeps resolution behind the existing machine and permission guards, with public generic discovery', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, BillingConnectionsController),
    ).toEqual([BillingInternalAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        Reflect.get(
          BillingConnectionsController.prototype,
          'resolve',
        ) as object,
      ),
    ).toEqual(['billing.integration.catalog.read']);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ConnectionDiscoveryController),
    ).toBeUndefined();
  });

  it('uses a separate connection-only permission in v2 and preserves the v1 catalog contract', async () => {
    const f = fixture();
    const v2 = new BillingConnectionsV2Controller(f.service);
    expect(
      new ConnectionDiscoveryV2Controller(f.service).discovery(),
    ).toMatchObject({
      contract: 'hemia.payments.connections.v2',
      scope: 'billing.integration.connections.read',
      configurationPath:
        '/api/v1/billing/integrations/v2/connections/{connectionCode}',
    });
    expect(
      Reflect.getMetadata(GUARDS_METADATA, BillingConnectionsV2Controller),
    ).toEqual([BillingInternalAuthGuard, PermissionsGuard]);
    const reflector = new Reflector();
    const guard = new PermissionsGuard(
      reflector,
      {} as never,
      new BillingServicePolicyGuard(
        reflector,
        {} as never,
        f.authorization as never,
      ),
    );
    const context = (
      controller:
        | typeof BillingConnectionsController
        | typeof BillingConnectionsV2Controller,
    ) =>
      ({
        getClass: () => controller,
        getHandler: () =>
          Reflect.get(controller.prototype, 'resolve') as ReturnType<
            ExecutionContext['getHandler']
          >,
        switchToHttp: () => ({ getRequest: () => f.request }),
      }) as ExecutionContext;
    f.request.principal!.scopes = ['billing.integration.connections.read'];
    await expect(
      guard.canActivate(context(BillingConnectionsV2Controller)),
    ).resolves.toBe(true);
    await expect(v2.resolve(f.request, 'application')).resolves.toMatchObject({
      contract: 'hemia.payments.connection.v2',
      configuration: f.configuration,
    });
    await expect(
      guard.canActivate(context(BillingConnectionsController)),
    ).rejects.toThrow(ForbiddenException);
    f.request.principal!.scopes = ['billing.integration.catalog.read'];
    await expect(
      guard.canActivate(context(BillingConnectionsController)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(context(BillingConnectionsV2Controller)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects secrets and unsupported fields in a published snapshot', () => {
    const f = fixture();
    expect(() =>
      parseBillingServicePolicy({
        ...f.policy,
        connections: {
          application: {
            version: 1,
            configuration: {
              ...f.configuration,
              clientSecret: 'must-not-be-stored',
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseBillingServicePolicy({
        ...f.policy,
        connections: {
          discovery: {
            version: 1,
            configuration: f.configuration,
          },
        },
      }),
    ).toThrow();
  });

  it.each([
    ['issuer', 'https://identity.test?unexpected=1'],
    ['tokenUrl', 'https://identity.test/oauth/token?unexpected=1'],
    ['baseUrl', 'https://billing.test/api/v1?unexpected=1'],
    ['resource', 'https://billing.test?unexpected=1'],
    ['legal.baseUrl', 'https://legal.test?unexpected=1'],
    ['legal.resource', 'https://legal.test?unexpected=1'],
    ['legal.resource', 'https://another-legal.test'],
    ['legal.baseUrl', 'invalid-url'],
    ['clientId', 'a'.repeat(121)],
    ['audience', 'has spaces'],
    ['receiver.audience', 'a'.repeat(121)],
    ['legal.verificationClientId', 'a'.repeat(121)],
    ['productCode', 'a'.repeat(81)],
    ['productCode', 'has spaces'],
  ])('rejects incompatible snapshot field %s = %s', (field, value) => {
    const configuration = structuredClone(fixture().configuration) as Record<
      string,
      string | Record<string, string>
    >;
    const [group, key] = field.split('.');
    if (key) (configuration[group] as Record<string, string>)[key] = value;
    else configuration[group] = value;
    expect(
      billingConnectionConfiguration.safeParse(configuration).success,
    ).toBe(false);
  });

  it('keeps query parameters on return URLs and accepts identifier length boundaries', () => {
    const configuration = {
      ...fixture().configuration,
      clientId: 'a'.repeat(120),
      productCode: 'a'.repeat(80),
      successUrl: 'https://application.test/success?attemptId=123',
      cancelUrl: 'https://application.test/cancel?attemptId=123',
    };
    expect(billingConnectionConfiguration.parse(configuration)).toEqual(
      configuration,
    );
  });
});
