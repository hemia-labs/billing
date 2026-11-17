import { randomUUID } from 'node:crypto';
import { DataSource, EntitySchema, SelectQueryBuilder } from 'typeorm';
import { BillingPaymentEntity } from '../../../../apps/api/src/modules/billing-shared';
import { BillingPaymentHistoryService } from '../../../../apps/api/src/modules/payment-history/billing-payment-history.service';
import { BillingServicePolicyService } from '../../../../apps/api/src/common/services/billing-service-policy.service';

const organizationId = randomUUID(), subscriptionId = randomUUID();
const query = { organization_id: organizationId, product_code: 'medsync' };
const actor = { issuer: 'https://identity.test', clientId: 'medsync' };
const makeRow = (patch: Record<string, unknown> = {}) => ({
  id: randomUUID(), subscriptionId, organizationId, productCode: 'medsync', provider: 'paypal', amount: '499.00', currency: 'MXN', status: 'paid',
  paidAt: new Date('2026-11-17T10:00:00.123Z'), createdAt: new Date('2026-11-17T10:00:00.123Z'), reference: 'PAYPAL-CAPTURE',
  refundedAmount: '0', operation: null, initialPayment: false, ...patch,
});

describe('read-only payment history', () => {
  let dataSource: DataSource;
  let rows: ReturnType<typeof makeRow>[];
  let anchor: { orderedAt: string } | undefined;
  let sql: string, parameters: unknown[];
  let policy: { assertContext: jest.Mock };
  let service: BillingPaymentHistoryService;
  let queries: number;
  beforeAll(async () => {
    // Query-only schemas keep unrelated application's entity validators out of this isolated SQL test.
    const subscription = new EntitySchema({ name: 'HistorySubscription', tableName: 'subscriptions', columns: {
      id: { type: 'uuid', primary: true }, organizationId: { type: 'uuid', name: 'organization_id' },
      productCode: { type: String, name: 'product_code' }, deletedAt: { type: Date, name: 'deleted_at', deleteDate: true },
    } });
    const payment = new EntitySchema({ name: 'BillingPaymentEntity', target: BillingPaymentEntity, tableName: 'payments', columns: {
      id: { type: 'uuid', primary: true }, organizationId: { type: 'uuid', name: 'organization_id' },
      subscriptionId: { type: 'uuid', name: 'subscription_id' }, provider: { type: String },
      amount: { type: 'decimal', precision: 12, scale: 2 }, currency: { type: String }, status: { type: String },
      paidAt: { type: Date, name: 'paid_at', nullable: true }, createdAt: { type: Date, name: 'created_at' },
      providerCaptureId: { type: String, name: 'provider_capture_id' }, providerPaymentId: { type: String, name: 'provider_payment_id' },
      metadata: { type: 'jsonb' },
    }, relations: { subscription: { type: 'many-to-one', target: 'HistorySubscription', joinColumn: { name: 'subscription_id' } } } });
    dataSource = new DataSource({ type: 'postgres', entities: [payment, subscription], synchronize: false });
    await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
  });
  beforeEach(() => {
    rows = []; anchor = undefined; queries = 0;
    policy = { assertContext: jest.fn().mockResolvedValue(undefined) };
    jest.spyOn(SelectQueryBuilder.prototype, 'getRawMany').mockImplementation(function(this: SelectQueryBuilder<BillingPaymentEntity>) {
      [sql, parameters] = this.getQueryAndParameters(); queries++; return Promise.resolve(rows);
    });
    jest.spyOn(SelectQueryBuilder.prototype, 'getRawOne').mockImplementation(function(this: SelectQueryBuilder<BillingPaymentEntity>) {
      [sql, parameters] = this.getQueryAndParameters(); queries++; return Promise.resolve(anchor);
    });
    service = new BillingPaymentHistoryService(dataSource.getRepository(BillingPaymentEntity), policy as unknown as BillingServicePolicyService);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses an authorized org/product ledger query, preserves old subscriptions and never performs provider I/O', async () => {
    rows = [makeRow({ initialPayment: true, metadata: { paypalResource: 'private' } }), makeRow({ subscriptionId: randomUUID(), operation: 'plan_change_proration' }), makeRow({ subscriptionId: randomUUID(), paidAt: null })];
    const result = await service.list(query, actor);
    expect(policy.assertContext).toHaveBeenCalledWith(actor, 'medsync', organizationId);
    expect(queries).toBe(1); expect(result.items).toHaveLength(3); expect(result.nextCursor).toBeNull();
    expect(result.items.map(item => item.description)).toEqual(['Pago inicial de suscripción', 'Prorrateo por cambio de plan', 'Pago de suscripción']);
    expect(result.items[2].paidAt).toBeNull(); expect(result.items[2].createdAt).toBe('2026-11-17T10:00:00.123Z');
    expect(result.items[0]).not.toHaveProperty('metadata'); expect(result.items[0]).not.toHaveProperty('paypalResource');
    expect(sql).toContain('"payment"."organization_id" ='); expect(sql).toContain('"subscription"."organization_id" =');
    expect(sql).toContain('"subscription"."product_code" ='); expect(sql).not.toContain('deleted_at');
    expect(sql).toContain('"payment"."status" IN'); expect(sql).toContain('"payment"."provider" =');
    expect(sql).toContain('LIMIT 26'); expect(sql).toContain('refund.payment_id="payment"."id"');
    expect(parameters).toEqual([organizationId, 'medsync', 'paypal', 'paid', 'refunded', 'reversed']);
  });

  it('derives partial refunds only from confirmed ledger amounts using exact cents', async () => {
    rows = [makeRow({ amount: '9999999999.99', refundedAmount: '0.01' }), makeRow({ status: 'refunded', refundedAmount: '499.00' }), makeRow({ status: 'reversed' })];
    const page = await service.list(query, actor);
    expect(page.items.map(item => item.status)).toEqual(['partially_refunded', 'refunded', 'reversed']);
    expect(page.items[0].amount).toBe('9999999999.99'); expect(page.items[0].refundedAmount).toBe('0.01');
    expect(page.items[2]).not.toHaveProperty('refundedAmount');
    rows = [makeRow({ refundedAmount: '500.00' })]; await expect(service.list(query, actor)).rejects.toThrow('Invalid recorded payment refund');
    rows = [makeRow({ amount: '1e2' })]; await expect(service.list(query, actor)).rejects.toThrow('Invalid recorded payment amount');
  });

  it('caps pages at 25 and resumes keyset on the exact stored timestamp and ID', async () => {
    rows = Array.from({ length: 26 }, () => makeRow());
    const first = await service.list(query, actor);
    expect(first.items).toHaveLength(25); expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const cursor = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString());
    expect(cursor).toEqual({ v: 1, organizationId, productCode: 'medsync', id: rows[24].id });
    anchor = { orderedAt: '2026-11-17 10:00:00.123456+00' }; rows = [makeRow()];
    const next = await service.list({ ...query, cursor: first.nextCursor! }, actor);
    expect(next.items).toHaveLength(1); expect(next.nextCursor).toBeNull();
    expect(sql).toContain('COALESCE("payment"."paid_at", "payment"."created_at") <');
    expect(sql).toContain('"payment"."id" <'); expect(parameters).toContain(anchor.orderedAt); expect(parameters).toContain(cursor.id);
    expect(sql).toContain('ORDER BY COALESCE("payment"."paid_at", "payment"."created_at") DESC, "payment"."id" DESC');
  });

  it('rejects malformed, foreign scope and unknown cursors without broadening the query', async () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const cursor of ['!', 'x'.repeat(2049), encode({ v: 1, organizationId: randomUUID(), productCode: 'medsync', id: randomUUID() }), encode({ v: 1, organizationId, productCode: 'other', id: randomUUID() }), encode({ v: 1, organizationId, productCode: 'medsync', id: 'bad' }), encode({ v: 1, organizationId, productCode: 'medsync', id: randomUUID(), extra: true })])
      await expect(service.list({ ...query, cursor }, actor)).rejects.toThrow('Invalid payment history cursor');
    expect(queries).toBe(0);
    await expect(service.list({ ...query, cursor: encode({ v: 1, organizationId, productCode: 'medsync', id: randomUUID() }) }, actor)).rejects.toThrow('Invalid payment history cursor');
    expect(queries).toBe(1);
  });

  it('checks current service policy before any history query', async () => {
    policy.assertContext.mockRejectedValue(new Error('out of scope'));
    await expect(service.list(query, actor)).rejects.toThrow('out of scope'); expect(queries).toBe(0);
  });
});
