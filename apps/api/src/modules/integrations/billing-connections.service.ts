import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingServicePolicyService } from '../../common/services/billing-service-policy.service';
import {
  billingConnectionCode,
  billingConnectionConfiguration,
} from '../../common/types/billing-service-policy';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { billingServiceAuthorization } from '../../common/types/billing-service-authorization.type';
import { BillingProductEntity } from '../billing-shared/entities/billing-product.entity';
import { BillingProductStatus } from '../billing-shared';

function configuredEndpoint(config: ConfigService, value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== 'https:' &&
      !(
        config.get<string>('app.nodeEnv') !== 'production' &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new Error('Unsafe configured endpoint');
  return url;
}

const connectionReadScope = 'billing.integration.connections.read';
type ConnectionContract = 'v1' | 'v2';

export function billingConnectionDiscovery(
  config: ConfigService,
  version: ConnectionContract = 'v1',
) {
  try {
    const issuer =
      config.get<string>('auth.requiredIssuer') ||
      config.get<string>('auth.issuerUrl') ||
      config.getOrThrow<string>('sso.issuer');
    const issuerUrl = configuredEndpoint(config, issuer);
    const token = configuredEndpoint(
      config,
      config.get<string>('sso.tokenUrl') ||
        new URL('/oauth/token', issuerUrl).href,
    );
    if (token.origin !== issuerUrl.origin)
      throw new Error('Token issuer mismatch');
    const resource = configuredEndpoint(
      config,
      config.getOrThrow<string>('sso.redirectUri'),
    ).origin;
    const prefix = (config.get<string>('app.globalPrefix') ?? 'api/v1').replace(
      /^\/+|\/+$/g,
      '',
    );
    return {
      contract: `hemia.payments.connections.${version}` as const,
      issuer,
      tokenUrl: token.href,
      audience: config.getOrThrow<string>('auth.audience'),
      resource,
      scope:
        version === 'v2'
          ? connectionReadScope
          : 'billing.integration.catalog.read',
      configurationPath: `${prefix ? '/' + prefix : ''}/billing/integrations/${version}/connections/{connectionCode}`,
    };
  } catch {
    throw new ServiceUnavailableException(
      'Connection discovery is not configured',
    );
  }
}

export function assertBillingConnectionTarget(
  config: ConfigService,
  clientId: string,
  candidate: unknown,
) {
  const parsed = billingConnectionConfiguration.safeParse(candidate);
  if (!parsed.success)
    throw new BadRequestException('Invalid connection configuration');
  const connection = parsed.data;
  const metadata = billingConnectionDiscovery(config);
  const expectedBase = new URL(
    metadata.configurationPath.split('/billing/')[0] || '/',
    metadata.resource,
  ).href;
  if (
    connection.clientId !== clientId ||
    connection.issuer !== metadata.issuer ||
    connection.tokenUrl !== metadata.tokenUrl ||
    connection.audience !== metadata.audience ||
    connection.resource !== metadata.resource ||
    connection.baseUrl.replace(/\/+$/, '') !== expectedBase.replace(/\/+$/, '')
  )
    throw new BadRequestException(
      'Connection does not belong to this client and Billing environment',
    );
  if (
    config.get<string>('app.nodeEnv') === 'production' &&
    (connection.allowHttpLoopback ||
      [
        connection.issuer,
        connection.tokenUrl,
        connection.baseUrl,
        connection.resource,
        connection.successUrl,
        connection.cancelUrl,
        connection.legal?.baseUrl,
        connection.legal?.resource,
      ].some((url) => url?.startsWith('http:')))
  )
    throw new BadRequestException('Connection must use HTTPS in production');
  return connection;
}

@Injectable()
export class BillingConnectionsService {
  constructor(
    private readonly config: ConfigService,
    private readonly policy: BillingServicePolicyService,
    @InjectRepository(BillingProductEntity)
    private readonly products: Repository<BillingProductEntity>,
  ) {}

  discovery(version: ConnectionContract = 'v1') {
    return billingConnectionDiscovery(this.config, version);
  }

  async resolve(
    request: AuthenticatedRequest,
    code: string,
    version: ConnectionContract = 'v1',
  ) {
    if (!request.principal?.isMachine)
      throw new UnauthorizedException('Service bearer token required');
    if (!billingConnectionCode.safeParse(code).success)
      throw new BadRequestException('Invalid connection code');
    const authorization = billingServiceAuthorization(request);
    if (
      !authorization.policy.enabled ||
      authorization.clientId !== request.principal.clientId ||
      authorization.issuer !== request.principal.issuer
    )
      throw new UnauthorizedException(
        'Verified service authorization required',
      );
    const published = Object.hasOwn(
      authorization.policy.connections ?? {},
      code,
    )
      ? authorization.policy.connections![code]
      : undefined;
    if (!published) throw new NotFoundException('Connection not found');
    const configuration = assertBillingConnectionTarget(
      this.config,
      authorization.clientId,
      published.configuration,
    );
    this.policy.assertProduct(authorization, configuration.productCode);
    const product = await this.products.findOne({
      where: {
        code: configuration.productCode,
        status: BillingProductStatus.Active,
      },
      select: { id: true },
    });
    if (!product)
      throw new NotFoundException('Connection product is unavailable');
    return {
      contract: `hemia.payments.connection.${version}` as const,
      connectionCode: code,
      version: published.version,
      configuration,
    };
  }
}
