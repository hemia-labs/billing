import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type BillingServiceResource =
  | 'products'
  | 'plans'
  | 'addons'
  | 'subscriptions'
  | 'checkout_sessions'
  | 'subscription_addons'
  | 'payments'
  | 'invoices';

export type BillingResourceContext = {
  productCode: string | null;
  organizationId?: string;
  metadata?: Record<string, unknown>;
};

const resourceSql: Record<BillingServiceResource, string> = {
  products:
    'SELECT code AS "productCode" FROM products WHERE id=$1 AND deleted_at IS NULL',
  plans:
    'SELECT p.code AS "productCode" FROM plans r JOIN products p ON p.id=r.product_id WHERE r.id=$1 AND r.deleted_at IS NULL AND p.deleted_at IS NULL',
  addons:
    'SELECT product_code AS "productCode" FROM addons WHERE id=$1 AND deleted_at IS NULL',
  subscriptions:
    'SELECT product_code AS "productCode", organization_id AS "organizationId" FROM subscriptions WHERE id=$1 AND deleted_at IS NULL',
  checkout_sessions:
    'SELECT product_code AS "productCode", organization_id AS "organizationId", metadata FROM checkout_sessions WHERE id=$1 AND deleted_at IS NULL',
  subscription_addons:
    'SELECT s.product_code AS "productCode", s.organization_id AS "organizationId" FROM subscription_addons a JOIN subscriptions s ON s.id=a.subscription_id WHERE a.id=$1 AND a.deleted_at IS NULL AND s.deleted_at IS NULL',
  payments:
    'SELECT s.product_code AS "productCode", p.organization_id AS "organizationId" FROM payments p LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE p.id=$1',
  invoices:
    'SELECT s.product_code AS "productCode", i.organization_id AS "organizationId" FROM invoices i JOIN payments p ON p.id=i.payment_id LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE i.id=$1 AND i.deleted_at IS NULL',
};

@Injectable()
export class BillingResourceContextRepository {
  constructor(private readonly database: DataSource) {}

  // Authorization always uses the stored resource context, not request fields.
  async findContext(
    resource: BillingServiceResource,
    id: string,
  ): Promise<BillingResourceContext | null> {
    const rows = await this.database.query<BillingResourceContext[]>(
      resourceSql[resource],
      [id],
    );
    return rows[0] ?? null;
  }
}
