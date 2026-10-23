import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BillingAuditService } from '../audit/billing-audit.service';
import { BillingIdentityOAuthClientsService } from './oauth-clients/billing-identity-oauth-clients.service';
import { BillingServiceClientsService } from './service-clients/billing-service-clients.service';
import { SaveLicenseReceiverDto } from './dtos/save-license-receiver.dto';
import { LicenseWebhookDeliveryService } from '../licenses/license-webhook-delivery.service';

@Injectable()
export class BillingIntegrationAdminService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly identity: BillingIdentityOAuthClientsService,
    private readonly clients: BillingServiceClientsService,
    private readonly audit: BillingAuditService,
    private readonly deliveries: LicenseWebhookDeliveryService,
  ) {}
  async options() {
    const [products, organizations, clients, policies, receivers] =
      await Promise.all([
        this.db.query<Array<{ id: string; code: string; name: string }>>(
          'SELECT id,code,name FROM products WHERE deleted_at IS NULL ORDER BY name',
        ),
        this.db.query<Array<{ id: string; name: string; code: string }>>(
          'SELECT organization_id AS id,name,code FROM tenants ORDER BY name',
        ),
        this.identity.listServiceClients(),
        this.clients.list(),
        this.db.query<Array<SaveLicenseReceiverDto & { productCode: string }>>(
          'SELECT product_code AS "productCode",url,audience,resource,enabled FROM billing_license_receivers ORDER BY product_code',
        ),
      ]);
    return {
      service: {
        audience: this.config.getOrThrow<string>('auth.audience'),
        clientId: this.config.getOrThrow<string>('hemiaLegal.clientId'),
      },
      products,
      organizations,
      clients,
      policies,
      receivers,
    };
  }
  async saveReceiver(
    productCode: string,
    dto: SaveLicenseReceiverDto,
    actorSubject: string,
    actorClientId: string,
  ) {
    const url = this.endpoint(dto.url);
    const resource = this.endpoint(dto.resource);
    if (
      resource.origin !== url.origin ||
      resource.href !== resource.origin + '/'
    )
      throw new BadRequestException(
        'El resource debe ser el origen del receptor.',
      );
    const configured = { ...dto, url: url.href, resource: resource.origin };
    if (configured.enabled)
      await this.identity.assertDestination(
        this.config.getOrThrow<string>('hemiaLegal.clientId'),
        configured,
        'billing.webhooks.deliver',
      );
    await this.db.transaction(async (manager) => {
      const products: Array<{ id: string }> = await manager.query(
        'SELECT id FROM products WHERE code=$1 AND deleted_at IS NULL FOR SHARE',
        [productCode],
      );
      if (products.length !== 1)
        throw new NotFoundException('Producto no encontrado.');
      const rows: Array<{ id: string }> = await manager.query(
        `INSERT INTO billing_license_receivers(product_code,url,audience,resource,enabled) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(product_code) DO UPDATE SET url=excluded.url,audience=excluded.audience,resource=excluded.resource,enabled=excluded.enabled,updated_at=clock_timestamp() RETURNING id`,
        [
          productCode,
          configured.url,
          configured.audience,
          configured.resource,
          configured.enabled,
        ],
      );
      await manager.query(
        `INSERT INTO billing_license_deliveries(organization_id,product_code)
        SELECT organization_id,product_code FROM subscriptions WHERE product_code=$1
        UNION SELECT organization_id,product_code FROM licenses WHERE product_code=$1
        UNION SELECT organization_id,product_code FROM checkout_sessions WHERE product_code=$1
        ON CONFLICT(organization_id,product_code) DO UPDATE SET next_attempt_at=clock_timestamp(),revision=nextval('billing_license_revision_seq'),attempts=0`,
        [productCode],
      );
      await this.audit.record({
        manager,
        action: 'billing.integration.receiver.saved',
        resourceType: 'billing_license_receivers',
        resourceId: rows[0].id,
        metadata: {
          actorSubject,
          actorClientId,
          newStatus: configured.enabled,
        },
      });
    });
    return { productCode, ...configured };
  }
  async checkReceiver(productCode: string) {
    return this.deliveries.checkReceiver(productCode);
  }
  private endpoint(value: string) {
    try {
      const url = new URL(value);
      const local =
        this.config.get<string>('app.nodeEnv') !== 'production' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
      )
        throw new Error();
      return url;
    } catch {
      throw new BadRequestException(
        'URL de receptor inválida; requiere HTTPS u origen local de desarrollo.',
      );
    }
  }
}
