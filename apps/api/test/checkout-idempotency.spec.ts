import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import {
  BillingCheckoutSessionEntity,
  BillingCustomerEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingProvider,
  BillingSubscriptionEntity,
} from '../src/modules/billing-shared';
import { BillingCheckoutService } from '../src/modules/checkout/billing-checkout.service';
import { CreateCheckoutSessionDto } from '../src/modules/checkout/dtos';
import { CreateIntegrationCheckoutSessionDto } from '../src/modules/integrations/dtos';
import { ChangePlanDto } from '../src/modules/subscriptions-management/dtos';
import { PaypalClientService } from '../src/modules/paypal/paypal-client.service';
import { ConfigService } from '@nestjs/config';
import { BillingServicePolicyService } from '../src/common/services/billing-service-policy.service';
import { parseBillingServiceClients } from '../src/config/billing-service-clients';
import type { ValidateLegalAcceptanceInput } from '../src/modules/checkout/types';
import type { CreatePaypalSubscriptionInput } from '../src/modules/paypal/types';
import type { BillingAuditRecordInput } from '../src/modules/audit/types';
import { BillingSubscriptionsManagementService } from '../src/modules/subscriptions-management/billing-subscriptions-management.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  type Row = {
    id: string;
    metadata?: Record<string, unknown>;
    deletedAt?: Date;
    [key: string]: unknown;
  };
  const stored = new Map<unknown, Map<string, Row>>();
  const locks = new Map<string, Promise<void>>();
  const table = (entity: unknown) => {
    if (!stored.has(entity)) stored.set(entity, new Map());
    return stored.get(entity)!;
  };
  const queryBuilder = (
    rows: () => Map<string, Row>,
    lock?: (id: string) => Promise<void>,
  ) => {
    let organizationId: string, key: string, issuer: string, clientId: string;
    let needsLock = false,
      legacyOnly = false;
    const find = () =>
      [...rows().values()].find(
        (value) =>
          value.organizationId === organizationId &&
          value.metadata?.idempotencyKey === key &&
          (legacyOnly
            ? value.metadata.createdByIssuer == null ||
              value.metadata.createdByClientId == null
            : value.metadata.createdByIssuer === issuer &&
              value.metadata.createdByClientId === clientId),
      );
    const builder = {
      withDeleted: () => builder,
      setLock() {
        needsLock = true;
        return builder;
      },
      where(_sql: string, args: { organizationId: string }) {
        organizationId = args.organizationId;
        return builder;
      },
      andWhere(sql: string, args: Record<string, string> = {}) {
        if (sql.includes('IS NULL')) legacyOnly = true;
        if (args.key) key = args.key;
        if (args.issuer) issuer = args.issuer;
        if (args.clientId) clientId = args.clientId;
        return builder;
      },
      async getOne() {
        let row = find();
        if (row && needsLock && lock) {
          await lock(`row:${row.id}`);
          row = find();
        }
        return row ? structuredClone(row) : null;
      },
    };
    return builder;
  };
  let databaseTime = Date.now();
  let activeTransactions = 0;
  let failProviderCommit = false;
  const dataSource = {
    async transaction(callback: (manager: unknown) => Promise<unknown>) {
      activeTransactions++;
      const writes: Array<() => void> = [];
      const pending = new Map<unknown, Map<string, Row>>();
      const held = new Set<string>();
      const releases: Array<() => void> = [];
      const lock = async (key: string) => {
        if (held.has(key)) return;
        const previous = locks.get(key) ?? Promise.resolve();
        let release!: () => void;
        locks.set(
          key,
          new Promise<void>((resolve) => {
            release = resolve;
          }),
        );
        await previous;
        held.add(key);
        releases.push(release);
      };
      const repository = (entity: unknown) => {
        const rows = () =>
          new Map([...table(entity), ...(pending.get(entity) ?? [])]);
        const stage = (value: Row, patch = false) => {
          const row = structuredClone(value);
          if (!pending.has(entity)) pending.set(entity, new Map());
          pending.get(entity)!.set(row.id, row);
          writes.push(() =>
            table(entity).set(
              row.id,
              patch ? { ...table(entity).get(row.id), ...row } : row,
            ),
          );
          return structuredClone(row);
        };
        return {
          create: (value: Partial<Row>) => structuredClone(value),
          save(value: Partial<Row>) {
            return Promise.resolve(
              stage({
                createdAt: new Date(),
                ...value,
                id: value.id ?? randomUUID(),
              }),
            );
          },
          update(id: string, value: Partial<Row>) {
            stage({ ...value, id }, true);
            return Promise.resolve();
          },
          async findOne({
            where,
            lock: requestedLock,
          }: {
            where: Record<string, unknown>;
            lock?: { mode: string };
          }) {
            if (requestedLock && typeof where.id === 'string')
              await lock(`row:${where.id}`);
            const row = [...rows().values()].find(
              (value) =>
                !value.deletedAt &&
                Object.entries(where).every(
                  ([key, wanted]) => value[key] === wanted,
                ),
            );
            return row ? structuredClone(row) : null;
          },
          createQueryBuilder: () => {
            if (entity !== BillingCustomerEntity)
              return queryBuilder(rows, lock);
            let value: Partial<Row>;
            const builder = {
              insert: () => builder,
              values: (input: Partial<Row>) => {
                value = input;
                return builder;
              },
              orIgnore: () => builder,
              updateEntity: () => builder,
              async execute() {
                await lock(
                  `customer:${String(value.organizationId)}:${String(value.provider)}`,
                );
                const existing = [...rows().values()].find(
                  (row) =>
                    !row.deletedAt &&
                    row.organizationId === value.organizationId &&
                    row.provider === value.provider,
                );
                if (!existing)
                  stage({ createdAt: new Date(), ...value, id: randomUUID() });
              },
            };
            return builder;
          },
        };
      };
      const manager = {
        getRepository: repository,
        query: async (sql: string, args: string[] = []) => {
          if (sql === 'SELECT clock_timestamp() AS now')
            return [{ now: new Date(databaseTime) }];
          if (sql.includes('pg_advisory_xact_lock'))
            return lock(`advisory:${args[0]}`);
          throw new Error(`Unexpected query: ${sql}`);
        },
      };
      try {
        const result = await callback(manager);
        if (
          failProviderCommit &&
          [...(pending.get(BillingCheckoutSessionEntity)?.values() ?? [])].some(
            (row) => row.providerCheckoutUrl,
          )
        ) {
          failProviderCommit = false;
          throw new Error('Commit failed after PayPal creation');
        }
        writes.forEach((write) => write());
        return result;
      } finally {
        activeTransactions--;
        releases.reverse().forEach((release) => release());
      }
    },
  };
  const product = { id: randomUUID(), code: 'medsync', status: 'active' };
  const plan = {
    id: randomUUID(),
    code: 'basic',
    productId: product.id,
    status: 'active',
  };
  table(BillingProductEntity).set(product.id, product);
  table(BillingPlanEntity).set(plan.id, plan);
  const providerPrice = { id: randomUUID(), providerPriceId: 'P-ORIGINAL' };
  const price = { id: randomUUID(), code: 'monthly_mxn' };
  const legal = {
    validateAcceptance: jest.fn((input: ValidateLegalAcceptanceInput) =>
      Promise.resolve({
        ...input,
        acceptedAt: new Date().toISOString(),
        legalSnapshotHash: 'a'.repeat(64),
      }),
    ),
  };
  const resolver = { resolve: jest.fn(() => ({ price, providerPrice })) };
  const audit = {
    record: jest.fn<Promise<void>, [BillingAuditRecordInput]>(() =>
      Promise.resolve(),
    ),
  };
  const providerSubscriptions = new Map<
    string,
    { id: string; approvalUrl: string }
  >();
  const paypal = {
    createSubscription: jest.fn((input: CreatePaypalSubscriptionInput) => {
      const requestId = input.requestId;
      if (!requestId)
        throw new Error('A durable PayPal request ID is required');
      if (!providerSubscriptions.has(requestId)) {
        providerSubscriptions.set(requestId, {
          id: `I-${providerSubscriptions.size + 1}`,
          approvalUrl: 'https://paypal.test/approve',
        });
      }
      return Promise.resolve(providerSubscriptions.get(requestId)!);
    }),
    getSubscription: jest.fn(() =>
      Promise.resolve({
        id: 'I-1',
        approvalUrl: 'https://paypal.test/approve',
      }),
    ),
  };
  const actor = {
    issuer: 'https://identity.test',
    clientId: 'medsync-service',
  };
  const clients = parseBillingServiceClients(
    JSON.stringify({
      'medsync-service': {
        products: ['medsync'],
        organizationScope: 'all_for_allowed_products',
        allowedReturnOrigins: ['https://medsync.test'],
      },
      'another-service': {
        products: ['medsync'],
        organizationScope: 'all_for_allowed_products',
        allowedReturnOrigins: ['https://medsync.test'],
      },
    }),
  );
  const policy = new BillingServicePolicyService(
    new ConfigService({
      auth: { requiredIssuer: actor.issuer, serviceClients: clients },
    }),
  );
  const readRepository = (entity: unknown) => ({
    createQueryBuilder: () => queryBuilder(() => table(entity)),
    findOne: ({ where }: { where: { id: string } }) =>
      Promise.resolve(structuredClone(table(entity).get(where.id) ?? null)),
  });
  const service = () =>
    new BillingCheckoutService(
      dataSource as never,
      legal as never,
      paypal as never,
      audit as never,
      readRepository(BillingCheckoutSessionEntity) as never,
      readRepository(BillingSubscriptionEntity) as never,
      resolver as never,
      policy,
    );
  const input: CreateCheckoutSessionDto = {
    idempotencyKey: randomUUID(),
    organizationId: randomUUID(),
    userId: randomUUID(),
    productCode: 'medsync',
    planCode: 'basic',
    planPriceCode: 'monthly_mxn',
    provider: BillingProvider.Paypal,
    legalAcceptanceId: randomUUID(),
    successUrl: 'https://medsync.test/success',
    cancelUrl: 'https://medsync.test/cancel',
    billingEmail: 'admin@medsync.test',
  };
  return {
    service,
    actor,
    clients,
    input,
    table,
    paypal,
    legal,
    resolver,
    providerPrice,
    providerSubscriptions,
    audit,
    dataSource,
    readRepository,
    activeTransactions: () => activeTransactions,
    advanceDatabaseTime: (ms: number) => {
      databaseTime += ms;
    },
    failNextProviderCommit: () => {
      failProviderCommit = true;
    },
  };
}

describe('checkout idempotency', () => {
  it.each([
    new ForbiddenException('Buyer can no longer contract'),
    new BadRequestException('Acceptance is no longer current'),
    new ServiceUnavailableException('Consumer context is unavailable'),
  ])(
    'revalidates pending retries and releases the lease on Legal rejection: %s',
    async (rejection) => {
      const f = fixture();
      f.paypal.createSubscription.mockRejectedValueOnce(
        new Error('PayPal timeout'),
      );
      await expect(
        f.service().createCheckoutSession(f.input, f.actor),
      ).rejects.toMatchObject({ status: 502 });
      const original = [...f.table(BillingCheckoutSessionEntity).values()][0];
      f.legal.validateAcceptance.mockRejectedValueOnce(rejection);
      await expect(
        f.service().createCheckoutSession(f.input, f.actor),
      ).rejects.toBe(rejection);
      expect(f.legal.validateAcceptance).toHaveBeenLastCalledWith({
        organizationId: f.input.organizationId,
        userId: f.input.userId,
        legalAcceptanceId: f.input.legalAcceptanceId,
        productCode: f.input.productCode,
      });
      expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
      expect(f.paypal.getSubscription).not.toHaveBeenCalled();
      const failed = f.table(BillingCheckoutSessionEntity).get(original.id)!;
      expect(failed.metadata.attemptId).toBeUndefined();
      expect(failed.metadata.leaseUntil).toBeUndefined();
      expect(f.table(BillingCheckoutSessionEntity).size).toBe(1);
      expect(f.table(BillingSubscriptionEntity).size).toBe(1);
      expect(f.activeTransactions()).toBe(0);
      const recovered = await f
        .service()
        .createCheckoutSession(f.input, f.actor);
      expect(recovered.checkoutId).toBe(original.id);
      expect(f.paypal.createSubscription.mock.calls[1][0]).toEqual(
        f.paypal.createSubscription.mock.calls[0][0],
      );
    },
  );
  it.each(['successUrl', 'cancelUrl'] as const)(
    'rejects an unauthorized %s before Legal, PayPal or database work',
    async (field) => {
      const f = fixture();
      await expect(
        f
          .service()
          .createCheckoutSession(
            { ...f.input, [field]: 'https://other.test/return' },
            f.actor,
          ),
      ).rejects.toMatchObject({ status: 403 });
      expect(f.table(BillingCustomerEntity).size).toBe(0);
      expect(f.table(BillingCheckoutSessionEntity).size).toBe(0);
      expect(f.legal.validateAcceptance).not.toHaveBeenCalled();
      expect(f.paypal.createSubscription).not.toHaveBeenCalled();
    },
  );

  it.each([
    'http://medsync.test/success',
    'ftp://medsync.test/success',
    'medsync.test/success',
    'https://user:pass@medsync.test/success',
    'https:\\medsync.test\\success',
  ])(
    'rejects invalid return URL syntax or protocol: %s',
    async (successUrl) => {
      const f = fixture();
      await expect(
        f.service().createCheckoutSession({ ...f.input, successUrl }, f.actor),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.legal.validateAcceptance).not.toHaveBeenCalled();
      expect(f.paypal.createSubscription).not.toHaveBeenCalled();
    },
  );

  it('checks return origin authorization again before replaying a completed checkout', async () => {
    const f = fixture();
    await f.service().createCheckoutSession(f.input, f.actor);
    f.clients[f.actor.clientId].allowedReturnOrigins = [];
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('rejects persisted unauthorized callbacks instead of forwarding them during recovery', async () => {
    const f = fixture();
    f.paypal.createSubscription.mockRejectedValueOnce(
      new Error('PayPal timeout'),
    );
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 502 });
    const checkout = [...f.table(BillingCheckoutSessionEntity).values()][0];
    checkout.cancelUrl = 'https://other.test/cancel';
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('creates a single customer for simultaneous independent checkout keys', async () => {
    const f = fixture();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        f
          .service()
          .createCheckoutSession(
            { ...f.input, idempotencyKey: randomUUID() },
            f.actor,
          ),
      ),
    );
    expect(new Set(responses.map((result) => result.checkoutId)).size).toBe(10);
    expect(f.table(BillingCustomerEntity).size).toBe(1);
    expect(f.table(BillingSubscriptionEntity).size).toBe(10);
  });

  it('allows a different intent to finish while the first database transaction is still open', async () => {
    const f = fixture();
    const id = randomUUID();
    f.table(BillingCustomerEntity).set(id, {
      id,
      organizationId: f.input.organizationId,
      provider: f.input.provider,
      billingEmail: f.input.billingEmail,
    });
    const started = deferred<void>(),
      gate = deferred<void>();
    f.audit.record.mockImplementationOnce(async () => {
      started.resolve();
      await gate.promise;
    });
    const first = f.service().createCheckoutSession(f.input, f.actor);
    await started.promise;
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        f
          .service()
          .createCheckoutSession(
            { ...f.input, idempotencyKey: randomUUID() },
            f.actor,
          ),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error('Different intent was serialized by organization'),
              ),
            2000,
          );
        }),
      ]);
      expect(f.activeTransactions()).toBe(1);
    } finally {
      clearTimeout(timer!);
      gate.resolve();
      await first;
    }
    expect(f.table(BillingCustomerEntity).size).toBe(1);
    expect(f.table(BillingCheckoutSessionEntity).size).toBe(2);
  });

  it('preserves a concurrent reservation when manually verifying a checkout', async () => {
    const f = fixture();
    const created = await f.service().createCheckoutSession(f.input, f.actor);
    const provider = {
      getSubscription: jest.fn(() => {
        const checkout = f
          .table(BillingCheckoutSessionEntity)
          .get(created.checkoutId)!;
        checkout.metadata = {
          ...checkout.metadata,
          attemptId: 'new-attempt',
          leaseUntil: '2030-01-01T00:00:00.000Z',
        };
        return Promise.resolve({ id: 'I-1', status: 'APPROVAL_PENDING' });
      }),
    };
    const management = new BillingSubscriptionsManagementService(
      f.dataSource as never,
      {} as never,
      {} as never,
      provider as never,
      {} as never,
      f.audit as never,
      {} as never,
      f.readRepository(BillingSubscriptionEntity) as never,
      {} as never,
      f.readRepository(BillingCheckoutSessionEntity) as never,
    );
    await expect(
      management.verifyCheckoutSession(created.checkoutId),
    ).resolves.toMatchObject({ checkoutStatus: 'pending' });
    expect(
      f.table(BillingCheckoutSessionEntity).get(created.checkoutId),
    ).toMatchObject({
      status: 'pending',
      metadata: {
        attemptId: 'new-attempt',
        leaseUntil: '2030-01-01T00:00:00.000Z',
      },
    });
  });

  it('executes Legal, PayPal creation and PayPal recovery with no open transaction', async () => {
    const f = fixture();
    const validate = f.legal.validateAcceptance.getMockImplementation()!;
    f.legal.validateAcceptance.mockImplementation((input) => {
      expect(f.activeTransactions()).toBe(0);
      return validate(input);
    });
    f.paypal.createSubscription.mockImplementation(() => {
      expect(f.activeTransactions()).toBe(0);
      return Promise.resolve({ id: 'I-1', approvalUrl: undefined as never });
    });
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 502 });
    const get = f.paypal.getSubscription.getMockImplementation()!;
    f.paypal.getSubscription.mockImplementation(() => {
      expect(f.activeTransactions()).toBe(0);
      return get();
    });
    await f.service().createCheckoutSession(f.input, f.actor);
    expect(f.activeTransactions()).toBe(0);
  });

  it('creates no records and does not contact PayPal when Legal fails', async () => {
    const f = fixture();
    f.legal.validateAcceptance.mockRejectedValueOnce(
      new Error('Legal unavailable'),
    );
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toThrow('Legal unavailable');
    expect(f.table(BillingCheckoutSessionEntity).size).toBe(0);
    expect(f.table(BillingSubscriptionEntity).size).toBe(0);
    expect(f.paypal.createSubscription).not.toHaveBeenCalled();
    expect(f.activeTransactions()).toBe(0);
  });

  it('rejects a simultaneous retry immediately and allows a different key in the same organization', async () => {
    const f = fixture();
    const started = deferred<void>();
    const gate = deferred<void>();
    const create = f.paypal.createSubscription.getMockImplementation()!;
    f.paypal.createSubscription.mockImplementationOnce(async (input) => {
      const result = await create(input);
      started.resolve();
      await gate.promise;
      return result;
    });
    const original = f.service().createCheckoutSession(f.input, f.actor);
    await started.promise;
    expect(f.activeTransactions()).toBe(0);
    const checkout = [...f.table(BillingCheckoutSessionEntity).values()][0];
    expect(typeof checkout.metadata?.attemptId).toBe('string');
    expect(typeof checkout.metadata?.leaseUntil).toBe('string');
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'CHECKOUT_IN_PROGRESS',
        checkoutId: checkout.id,
        retryAfterSeconds: 60,
      },
    });
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
    const other = await f
      .service()
      .createCheckoutSession(
        { ...f.input, idempotencyKey: randomUUID() },
        f.actor,
      );
    expect(other.checkoutId).not.toBe(checkout.id);
    expect(f.table(BillingCustomerEntity).size).toBe(1);
    gate.resolve();
    await original;
    expect(
      f.table(BillingCheckoutSessionEntity).get(checkout.id)?.metadata,
    ).not.toHaveProperty('attemptId');
  });

  it.each(['success', 'failure'] as const)(
    'does not overwrite a completed replacement with a late %s',
    async (outcome) => {
      const f = fixture();
      const started = deferred<void>();
      const gate = deferred<{ id: string; approvalUrl: string }>();
      const create = f.paypal.createSubscription.getMockImplementation()!;
      f.paypal.createSubscription.mockImplementationOnce(async (input) => {
        await create(input);
        started.resolve();
        return gate.promise;
      });
      const original = f.service().createCheckoutSession(f.input, f.actor);
      await started.promise;
      const checkout = [...f.table(BillingCheckoutSessionEntity).values()][0];
      const originalAttemptId = checkout.metadata!.attemptId;
      f.advanceDatabaseTime(61_000);
      const replacement = await f
        .service()
        .createCheckoutSession(f.input, f.actor);
      const stored = structuredClone(
        f.table(BillingCheckoutSessionEntity).get(checkout.id),
      );
      expect(replacement.checkoutId).toBe(checkout.id);
      expect(f.paypal.createSubscription.mock.calls[1][0]).toEqual(
        f.paypal.createSubscription.mock.calls[0][0],
      );
      expect(stored?.metadata?.attemptId).not.toBe(originalAttemptId);
      if (outcome === 'success')
        gate.resolve({ id: 'I-1', approvalUrl: 'https://paypal.test/stale' });
      else gate.reject(new Error('Late timeout'));
      expect(await original).toEqual(replacement);
      expect(f.table(BillingCheckoutSessionEntity).get(checkout.id)).toEqual(
        stored,
      );
      expect(f.providerSubscriptions.size).toBe(1);
      expect(
        f.audit.record.mock.calls.some(
          ([record]) => record.action === 'billing.checkout.failed',
        ),
      ).toBe(false);
    },
  );

  it('keeps a newer active reservation when the expired attempt returns first', async () => {
    const f = fixture();
    const firstStarted = deferred<void>(),
      secondStarted = deferred<void>();
    const firstResult = deferred<{ id: string; approvalUrl: string }>(),
      secondResult = deferred<{ id: string; approvalUrl: string }>();
    f.paypal.createSubscription.mockImplementationOnce(() => {
      firstStarted.resolve();
      return firstResult.promise;
    });
    f.paypal.createSubscription.mockImplementationOnce(() => {
      secondStarted.resolve();
      return secondResult.promise;
    });
    const original = f.service().createCheckoutSession(f.input, f.actor);
    await firstStarted.promise;
    f.advanceDatabaseTime(61_000);
    const replacement = f.service().createCheckoutSession(f.input, f.actor);
    await secondStarted.promise;
    const stored = structuredClone(
      [...f.table(BillingCheckoutSessionEntity).values()][0],
    );
    firstResult.resolve({
      id: 'I-1',
      approvalUrl: 'https://paypal.test/stale',
    });
    await expect(original).rejects.toMatchObject({
      status: 409,
      response: { code: 'CHECKOUT_IN_PROGRESS' },
    });
    expect(f.table(BillingCheckoutSessionEntity).get(stored.id)).toEqual(
      stored,
    );
    expect(
      [...f.table(BillingSubscriptionEntity).values()][0]
        .providerSubscriptionId,
    ).toBeNull();
    secondResult.resolve({
      id: 'I-1',
      approvalUrl: 'https://paypal.test/current',
    });
    expect((await replacement).checkoutUrl).toBe('https://paypal.test/current');
  });

  it.each(['success', 'failure'] as const)(
    'preserves current webhook state and metadata on provider %s',
    async (outcome) => {
      const f = fixture();
      f.paypal.createSubscription.mockImplementationOnce(() => {
        const checkout = [...f.table(BillingCheckoutSessionEntity).values()][0];
        const subscription = [
          ...f.table(BillingSubscriptionEntity).values(),
        ][0];
        checkout.status = 'cancelled';
        checkout.metadata!.webhookEvidence = 'latest';
        subscription.status = 'cancelled';
        subscription.nextBillingTime = new Date('2030-01-01');
        subscription.metadata!.webhookEvidence = 'latest';
        if (outcome === 'failure')
          return Promise.reject(new Error('PayPal timeout'));
        return Promise.resolve({
          id: 'I-1',
          approvalUrl: 'https://paypal.test/approve',
        });
      });
      const attempt = f.service().createCheckoutSession(f.input, f.actor);
      if (outcome === 'failure')
        await expect(attempt).rejects.toMatchObject({ status: 502 });
      else
        await expect(attempt).resolves.toMatchObject({ status: 'cancelled' });
      expect(
        [...f.table(BillingCheckoutSessionEntity).values()][0],
      ).toMatchObject({
        status: 'cancelled',
        metadata: { webhookEvidence: 'latest' },
      });
      expect([...f.table(BillingSubscriptionEntity).values()][0]).toMatchObject(
        {
          status: 'cancelled',
          metadata: { webhookEvidence: 'latest' },
          nextBillingTime: new Date('2030-01-01'),
        },
      );
    },
  );

  it('persists the verified issuer and client_id on the checkout and subscription', async () => {
    const f = fixture();
    const result = await f.service().createCheckoutSession(f.input, f.actor);
    for (const [entity, id] of [
      [BillingCheckoutSessionEntity, result.checkoutId],
      [BillingSubscriptionEntity, result.subscriptionId],
    ] as const) {
      expect(f.table(entity).get(id)?.metadata).toMatchObject({
        createdByIssuer: f.actor.issuer,
        createdByClientId: f.actor.clientId,
      });
    }
  });

  it('uses distinct namespaces for two authorized clients using the same key and organization', async () => {
    const f = fixture();
    const first = await f.service().createCheckoutSession(f.input, f.actor);
    const otherActor = { ...f.actor, clientId: 'another-service' };
    const other = await f.service().createCheckoutSession(f.input, otherActor);
    expect(other.checkoutId).not.toBe(first.checkoutId);
    expect(
      await f.service().createCheckoutSession(f.input, otherActor),
    ).toEqual(other);
    expect(f.providerSubscriptions.size).toBe(2);
    expect(f.table(BillingCustomerEntity).size).toBe(1);
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(2);
    await expect(
      f.service().getCheckoutStatus(first.checkoutId, otherActor),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service().getCheckoutStatus(first.checkoutId, f.actor),
    ).resolves.toMatchObject({ checkoutId: first.checkoutId });
  });

  it('checks current policy before replaying a persisted approval URL', async () => {
    const f = fixture();
    const result = await f.service().createCheckoutSession(f.input, f.actor);
    f.clients[f.actor.clientId].enabled = false;
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.service().getCheckoutStatus(result.checkoutId, f.actor),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('rejects unauthorized product and organization before any external or database work', async () => {
    const f = fixture();
    f.clients[f.actor.clientId] = parseBillingServiceClients(
      JSON.stringify({
        restricted: {
          products: ['medsync'],
          organizationScope: 'organizations',
          organizationIds: [randomUUID()],
        },
      }),
    ).restricted;
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f
        .service()
        .createCheckoutSession({ ...f.input, productCode: 'other' }, f.actor),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.table(BillingCheckoutSessionEntity).size).toBe(0);
    expect(f.legal.validateAcceptance).not.toHaveBeenCalled();
    expect(f.paypal.createSubscription).not.toHaveBeenCalled();
  });

  it('requires reconciliation for an existing key without creator metadata', async () => {
    const f = fixture();
    const result = await f.service().createCheckoutSession(f.input, f.actor);
    const metadata = f
      .table(BillingCheckoutSessionEntity)
      .get(result.checkoutId)!.metadata!;
    delete metadata.createdByIssuer;
    delete metadata.createdByClientId;
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.service().getCheckoutStatus(result.checkoutId, f.actor),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.table(BillingCheckoutSessionEntity).size).toBe(1);
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('allows explicit shared reads only within the configured product and organization scope', async () => {
    const f = fixture();
    const result = await f.service().createCheckoutSession(f.input, f.actor);
    const otherActor = { ...f.actor, clientId: 'another-service' };
    f.clients[otherActor.clientId].allowSharedCheckouts = true;
    await expect(
      f.service().getCheckoutStatus(result.checkoutId, otherActor),
    ).resolves.toMatchObject({ checkoutId: result.checkoutId });
    f.clients[otherActor.clientId].products = ['other'];
    await expect(
      f.service().getCheckoutStatus(result.checkoutId, otherActor),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('replays persisted results across service instances without another validation or PayPal call', async () => {
    const f = fixture();
    const first = await f.service().createCheckoutSession(f.input, f.actor);
    f.resolver.resolve.mockImplementation(() => {
      throw new Error('Catalog was archived');
    });
    expect(
      await f.service().createCheckoutSession({ ...f.input }, f.actor),
    ).toEqual(first);
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
    expect(f.legal.validateAcceptance).toHaveBeenCalledTimes(1);
    expect(f.table(BillingCheckoutSessionEntity).size).toBe(1);
    expect(f.table(BillingSubscriptionEntity).size).toBe(1);
    expect(f.paypal.createSubscription.mock.calls[0][0].requestId).toBe(
      first.checkoutId,
    );
  });

  it('serializes concurrent requests from different instances into one checkout and provider subscription', async () => {
    const f = fixture();
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        f.service().createCheckoutSession({ ...f.input }, f.actor),
      ),
    );
    const completed = attempts.filter(
      (result) => result.status === 'fulfilled',
    );
    expect(completed.length).toBeGreaterThan(0);
    for (const result of attempts) {
      if (result.status === 'fulfilled')
        expect(result.value.checkoutId).toBe(completed[0].value.checkoutId);
      else
        expect(result.reason).toMatchObject({
          status: 409,
          response: { code: 'CHECKOUT_IN_PROGRESS' },
        });
    }
    expect(await f.service().createCheckoutSession(f.input, f.actor)).toEqual(
      completed[0].value,
    );
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
    expect(f.table(BillingCustomerEntity).size).toBe(1);
    expect(f.table(BillingSubscriptionEntity).size).toBe(1);
  });

  it.each([
    'userId',
    'planCode',
    'planPriceCode',
    'legalAcceptanceId',
    'successUrl',
    'cancelUrl',
    'billingEmail',
  ] as const)('rejects reuse of a key with a different %s', async (key) => {
    const f = fixture();
    await f.service().createCheckoutSession(f.input, f.actor);
    await expect(
      f.service().createCheckoutSession(
        {
          ...f.input,
          [key]:
            key === 'successUrl' || key === 'cancelUrl'
              ? 'https://medsync.test/changed'
              : 'changed',
        },
        f.actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('recovers a lost PayPal response with the same checkout UUID and frozen provider payload', async () => {
    const f = fixture();
    const create = f.paypal.createSubscription.getMockImplementation()!;
    f.paypal.createSubscription.mockImplementationOnce(async (input) => {
      await create(input);
      throw new Error('Response lost after provider accepted the request');
    });
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 502 });
    f.providerPrice.providerPriceId = 'P-NEW-CATALOG';
    const response = await f.service().createCheckoutSession(f.input, f.actor);
    expect(f.paypal.createSubscription.mock.calls[1][0]).toEqual(
      f.paypal.createSubscription.mock.calls[0][0],
    );
    expect(f.providerSubscriptions.size).toBe(1);
    expect(f.table(BillingSubscriptionEntity).size).toBe(1);
    expect(response.status).toBe('created');
  });

  it('keeps the durable request ID after a provider-success database rollback', async () => {
    const f = fixture();
    f.failNextProviderCommit();
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toThrow('Commit failed');
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CHECKOUT_IN_PROGRESS' },
    });
    f.advanceDatabaseTime(61_000);
    const response = await f.service().createCheckoutSession(f.input, f.actor);
    expect(f.paypal.createSubscription.mock.calls[0][0].requestId).toBe(
      response.checkoutId,
    );
    expect(f.paypal.createSubscription.mock.calls[1][0]).toEqual(
      f.paypal.createSubscription.mock.calls[0][0],
    );
    expect(f.providerSubscriptions.size).toBe(1);
    expect(f.table(BillingSubscriptionEntity).size).toBe(1);
  });

  it('recovers a missing approval link through the saved provider ID without another POST', async () => {
    const f = fixture();
    f.paypal.createSubscription.mockResolvedValueOnce({
      id: 'I-1',
      approvalUrl: undefined as never,
    });
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 502 });
    expect(
      (await f.service().createCheckoutSession(f.input, f.actor)).checkoutUrl,
    ).toBe('https://paypal.test/approve');
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
    expect(f.paypal.getSubscription).toHaveBeenCalledWith('I-1');
  });

  it('blocks unresolved retries after PayPal expires its idempotency key', async () => {
    const f = fixture();
    f.paypal.createSubscription.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 502 });
    [...f.table(BillingCheckoutSessionEntity).values()][0].createdAt = new Date(
      Date.now() - 73 * 3600000,
    );
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('scopes client keys by organization and prevents reusing soft-deleted checkouts', async () => {
    const f = fixture();
    const first = await f.service().createCheckoutSession(f.input, f.actor);
    const other = await f
      .service()
      .createCheckoutSession(
        { ...f.input, organizationId: randomUUID() },
        f.actor,
      );
    expect(other.checkoutId).not.toBe(first.checkoutId);
    f.table(BillingCheckoutSessionEntity).get(first.checkoutId)!.deletedAt =
      new Date();
    await expect(
      f.service().createCheckoutSession(f.input, f.actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.paypal.createSubscription).toHaveBeenCalledTimes(2);
  });

  it.each([
    CreateCheckoutSessionDto,
    CreateIntegrationCheckoutSessionDto,
    ChangePlanDto,
  ])('%p requires a nonempty bounded key at the HTTP boundary', async (Dto) => {
    for (const key of [undefined, '', ' ', 'two words', 'a'.repeat(121)]) {
      const errors = await validate(
        Object.assign(new Dto(), { idempotencyKey: key }),
      );
      expect(errors.some((error) => error.property === 'idempotencyKey')).toBe(
        true,
      );
    }
    const errors = await validate(
      Object.assign(new Dto(), { idempotencyKey: randomUUID() }),
    );
    expect(errors.some((error) => error.property === 'idempotencyKey')).toBe(
      false,
    );
  });

  it('sends the durable request ID in the actual PayPal header', async () => {
    const original = global.fetch;
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'test-token', expires_in: 3600 }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'I-1',
            links: [{ rel: 'approve', href: 'https://paypal.test/approve' }],
          }),
        ),
      );
    global.fetch = fetcher;
    try {
      const client = new PaypalClientService(
        new ConfigService({
          paypal: {
            baseUrl: 'https://paypal.test',
            clientId: 'test',
            clientSecret: 'test',
          },
        }),
      );
      const requestId = randomUUID();
      await client.createSubscription({
        providerPlanId: 'P-1',
        customId: requestId,
        requestId,
        returnUrl: 'https://medsync.test/success',
        cancelUrl: 'https://medsync.test/cancel',
      });
      expect(
        new Headers(fetcher.mock.calls[1][1]?.headers).get('PayPal-Request-Id'),
      ).toBe(requestId);
    } finally {
      global.fetch = original;
    }
  });

  it.each([
    CreateCheckoutSessionDto,
    CreateIntegrationCheckoutSessionDto,
    ChangePlanDto,
  ])(
    '%p rejects callbacks without a protocol or with FTP or credentials',
    async (Dto) => {
      for (const value of [
        'medsync.test/success',
        'ftp://medsync.test/success',
        'https://user:pass@medsync.test/success',
      ]) {
        const errors = await validate(
          Object.assign(new Dto(), { successUrl: value, cancelUrl: value }),
        );
        for (const field of ['successUrl', 'cancelUrl'])
          expect(errors.some((error) => error.property === field)).toBe(true);
      }
      const errors = await validate(
        Object.assign(new Dto(), {
          successUrl: 'https://medsync.test/success',
          cancelUrl: 'http://localhost:5175/cancel',
        }),
      );
      expect(
        errors.some(
          (error) =>
            error.property === 'successUrl' || error.property === 'cancelUrl',
        ),
      ).toBe(false);
    },
  );
});
