import { Cron } from '@nestjs/schedule';
import { BillingQueueWakeup } from '../webhooks/billing-queue-wakeup';
import {
  BadGatewayException,
  NotFoundException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { BillingLicensesService } from './billing-licenses.service';

@Injectable()
export class LicenseWebhookDeliveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(LicenseWebhookDeliveryService.name);
  private wakeup: BillingQueueWakeup;
  private stopping = false;
  private cachedTokens = new Map<
    string,
    { value: string; expiresAt: number }
  >();
  private pendingTokens = new Map<string, Promise<string>>();

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly licenses: BillingLicensesService,
  ) {
    this.wakeup = new BillingQueueWakeup(
      this.db,
      'billing_license_deliveries',
      () => this.deliver(),
      `SELECT EXTRACT(EPOCH FROM (MIN(GREATEST(next_attempt_at,
        COALESCE(lease_until,next_attempt_at))) - clock_timestamp())) * 1000 AS delay_ms
        FROM billing_license_deliveries d JOIN billing_license_receivers r USING(product_code) WHERE r.enabled `,
    );
  }

  onApplicationBootstrap() {
    this.wakeup.onApplicationBootstrap();
  }

  @Cron('*/5 * * * *')
  recover(): void {
    this.wakeup.recover();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.wakeup.onApplicationShutdown();
  }

  private async deliver() {
    while (!this.stopping) {
      const token = randomUUID();
      const [rows] = await this.db.query<
        [
          Array<{
            organization_id: string;
            product_code: string;
            url: string;
            audience: string;
            resource: string;
            revision: string;
            attempts: number;
          }>,
          number,
        ]
      >(
        `
        WITH candidate AS (
          SELECT d.organization_id,d.product_code,r.url,r.audience,r.resource FROM billing_license_deliveries d JOIN billing_license_receivers r USING(product_code)
          WHERE r.enabled AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp())
          ORDER BY next_attempt_at LIMIT 1 FOR UPDATE OF d SKIP LOCKED
        ) UPDATE billing_license_deliveries d SET lease_token=$1,
          lease_until=clock_timestamp()+interval '90 seconds',revision=nextval('billing_license_revision_seq')
        FROM candidate c WHERE d.organization_id=c.organization_id AND d.product_code=c.product_code RETURNING d.organization_id,d.product_code,d.revision,d.attempts,c.url,c.audience,c.resource`,
        [token],
      );
      const item = rows[0];
      if (!item) return;
      let delivered = false;
      try {
        const url = this.endpoint(item.url);
        const resource = this.endpoint(item.resource);
        if (resource.origin !== url.origin)
          throw new Error('invalid_receiver_resource');
        const license = await this.licenses.resolveLicense(
          item.organization_id,
          item.product_code,
        );
        const checkouts = await this.db.query<Array<Record<string, unknown>>>(
          `
          SELECT c.id AS "checkoutId",s.id AS "subscriptionId",c.status AS "checkoutStatus",CASE WHEN c.metadata->>'operation'='plan_change' AND COALESCE(CASE WHEN s.metadata #>> '{pendingPlanChange,checkoutId}'=c.id::text THEN s.metadata #>> '{pendingPlanChange,state}' ELSE c.metadata->>'planChangeState' END,'pending')<>'effective' THEN 'pending' ELSE s.status::text END AS "subscriptionStatus"
          FROM checkout_sessions c LEFT JOIN subscriptions s
            ON s.id=CASE WHEN c.metadata->>'subscriptionId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN (c.metadata->>'subscriptionId')::uuid END
            AND s.organization_id=c.organization_id AND s.product_code=c.product_code
          WHERE c.organization_id=$1 AND c.product_code=$2 AND c.deleted_at IS NULL
          ORDER BY c.created_at DESC LIMIT 100`,
          [item.organization_id, item.product_code],
        );
        const body = JSON.stringify({
          type: 'billing.license.updated',
          organizationId: item.organization_id,
          productCode: item.product_code,
          revision: item.revision,
          license,
          checkouts,
        });
        const accessToken = await this.accessToken(item);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const response = await fetch(url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            'Content-Type': 'application/json',
            'x-billing-timestamp': timestamp,
            Authorization: `Bearer ${accessToken}`,
          },
          body,
        });
        if (
          response.status === 401 &&
          this.cachedTokens.get(this.tokenKey(item))?.value === accessToken
        ) {
          this.cachedTokens.delete(this.tokenKey(item));
        }
        if (!response.ok) throw new Error('delivery_rejected');
        const receipt = (await response.json()) as { received?: boolean };
        if (receipt.received !== true) throw new Error('invalid_receipt');
        delivered = true;
      } catch {
        this.logger.warn({
          event: 'license_webhook_delivery_failed',
          organizationId: item.organization_id,
          productCode: item.product_code,
        });
      }
      // A concurrent commit advances revision: release the lease and deliver again.
      // Periodic confirmation keeps the existing 24-hour fail-closed access policy.
      await this.db.query(
        `UPDATE billing_license_deliveries SET lease_token=NULL,lease_until=NULL,
        next_attempt_at=CASE WHEN revision<>$3 THEN clock_timestamp()
          WHEN $4 THEN clock_timestamp()+interval '6 hours'
          ELSE clock_timestamp()+($5 * interval '1 second') END,
        delivered_at=CASE WHEN $4 THEN clock_timestamp() ELSE delivered_at END,
        attempts=CASE WHEN revision<>$3 OR $4 THEN 0 ELSE attempts+1 END,
        last_error=CASE WHEN $4 THEN NULL ELSE 'DELIVERY_FAILED' END
        WHERE organization_id=$1 AND lease_token=$2 AND product_code=$6`,
        [
          item.organization_id,
          token,
          item.revision,
          delivered,
          Math.min(3600, 5 * 2 ** Math.min(item.attempts, 10)),
          item.product_code,
        ],
      );
    }
  }

  async checkReceiver(productCode: string) {
    const rows = await this.db.query<
      Array<{ url: string; resource: string; audience: string }>
    >(
      'SELECT url,resource,audience FROM billing_license_receivers WHERE product_code=$1 AND enabled',
      [productCode],
    );
    if (rows.length !== 1)
      throw new NotFoundException('Receptor activo no encontrado.');
    try {
      const receiver = rows[0];
      const url = this.endpoint(receiver.url);
      url.searchParams.set('productCode', productCode);
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          authorization: `Bearer ${await this.accessToken(receiver)}`,
          'x-billing-timestamp': String(Math.floor(Date.now() / 1000)),
        },
      });
      const body: unknown = response.ok ? await response.json() : null;
      if (
        !body ||
        typeof body !== 'object' ||
        !('ready' in body) ||
        body.ready !== true ||
        !('contract' in body) ||
        body.contract !== 'billing.license.receiver' ||
        !('productCode' in body) ||
        body.productCode !== productCode
      )
        throw new Error();
      return { ready: true, productCode, contract: 'billing.license.receiver' };
    } catch {
      throw new BadGatewayException(
        'No se pudo comprobar el receptor con la credencial instalada de Billing.',
      );
    }
  }

  private tokenKey(receiver: { audience: string; resource: string }) {
    return JSON.stringify([receiver.audience, receiver.resource]);
  }
  private async accessToken(receiver: {
    audience: string;
    resource: string;
  }): Promise<string> {
    const key = this.tokenKey(receiver);
    const cached = this.cachedTokens.get(key);
    if (cached && cached.expiresAt - 30_000 > Date.now()) return cached.value;
    const pending = this.pendingTokens.get(key);
    if (pending) return pending;
    const issued = this.issueToken(receiver).finally(() =>
      this.pendingTokens.delete(key),
    );
    this.pendingTokens.set(key, issued);
    return issued;
  }

  private async issueToken(receiver: {
    audience: string;
    resource: string;
  }): Promise<string> {
    const url = this.endpoint(
      this.config.getOrThrow<string>('hemiaLegal.tokenUrl'),
    );
    const clientId = this.config.getOrThrow<string>('hemiaLegal.clientId');
    const clientSecret = this.config.getOrThrow<string>(
      'hemiaLegal.clientSecret',
    );
    if (!clientId.trim() || !clientSecret.trim()) {
      throw new Error('billing_oauth_not_configured');
    }
    const startedAt = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: receiver.audience,
        resource: receiver.resource,
        scope: 'billing.webhooks.deliver',
      }),
    });
    if (!response.ok) throw new Error('billing_oauth_rejected');
    const token: unknown = await response.json();
    if (
      !token ||
      typeof token !== 'object' ||
      !('access_token' in token) ||
      typeof token.access_token !== 'string' ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        token.access_token,
      ) ||
      !('token_type' in token) ||
      token.token_type !== 'Bearer' ||
      !('expires_in' in token) ||
      typeof token.expires_in !== 'number' ||
      !Number.isInteger(token.expires_in) ||
      token.expires_in <= 0 ||
      token.expires_in > 600 ||
      !('scope' in token) ||
      token.scope !== 'billing.webhooks.deliver' ||
      startedAt + token.expires_in * 1000 <= Date.now()
    ) {
      throw new Error('invalid_billing_oauth_response');
    }
    this.cachedTokens.set(this.tokenKey(receiver), {
      value: token.access_token,
      expiresAt: startedAt + token.expires_in * 1000,
    });
    return token.access_token;
  }

  private endpoint(value: string): URL {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
          this.config.get<string>('app.nodeEnv') !== 'production'
        ))
    ) {
      throw new Error('invalid_billing_oauth_endpoint');
    }
    return url;
  }
}
