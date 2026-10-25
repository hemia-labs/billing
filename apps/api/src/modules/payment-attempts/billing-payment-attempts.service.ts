import { Cron } from '@nestjs/schedule';
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BillingServicePolicyService } from '../../common/services/billing-service-policy.service';
import type { BillingServiceActor } from '../../common/types/billing-service-authorization.type';
import { hasAllPermissions } from '../../common/guards/permissions.util';
import { BillingCheckoutService } from '../checkout';
import { CheckoutInProgressException } from '../checkout/errors/checkout-in-progress.exception';
import { BillingSubscriptionEntity } from '../billing-shared';
import { BillingSubscriptionsManagementService } from '../subscriptions-management/billing-subscriptions-management.service';
import { BillingPaymentAttemptEntity } from './billing-payment-attempt.entity';
import {
  CreatePaymentAttemptDto,
  PaymentAttemptContextDto,
  PaymentAttemptResponse,
} from './payment-attempt.dto';

@Injectable()
export class BillingPaymentAttemptsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly checkout: BillingCheckoutService,
    private readonly subscriptions: BillingSubscriptionsManagementService,
    private readonly policy: BillingServicePolicyService,
  ) {}

  private assertOwner(
    row: BillingPaymentAttemptEntity,
    context: PaymentAttemptContextDto,
    actor: BillingServiceActor,
  ) {
    if (
      row.organizationId !== context.organizationId.toLowerCase() ||
      row.userId !== context.userId.toLowerCase() ||
      row.productCode !== context.productCode ||
      row.createdByIssuer !== actor.issuer ||
      row.createdByClientId !== actor.clientId
    )
      throw new NotFoundException('Payment attempt not found');
  }
  private assertOperation(
    row: Pick<BillingPaymentAttemptEntity, 'requestPayload'>,
    permissions: string[],
  ) {
    if (
      row.requestPayload.operation === 'change_plan' &&
      !hasAllPermissions(permissions, ['billing.subscriptions.manage'])
    )
      throw new ForbiddenException('Subscription management scope required');
  }
  private async find(manager: EntityManager, id: string, lock = false) {
    return manager.getRepository(BillingPaymentAttemptEntity).findOne({
      where: { id: id.toLowerCase() },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }
  private async owned(
    id: string,
    context: PaymentAttemptContextDto,
    actor: BillingServiceActor,
  ) {
    await this.policy.assertContext(
      actor,
      context.productCode,
      context.organizationId.toLowerCase(),
    );
    const row = await this.find(this.dataSource.manager, id);
    if (!row) throw new NotFoundException('Payment attempt not found');
    this.assertOwner(row, context, actor);
    return row;
  }
  private response(
    row: BillingPaymentAttemptEntity,
    processing = false,
  ): PaymentAttemptResponse {
    const receipt = row.receipt;
    const change = receipt.planChange;
    let checkoutUrl =
      receipt.errorCode ||
      change?.action === 'none' ||
      ['scheduled', 'effective', 'failed'].includes(change?.state ?? '')
        ? undefined
        : change && 'checkoutUrl' in change
          ? (change.checkoutUrl ?? undefined)
          : change?.action === 'approve_payment'
            ? undefined
            : receipt.checkoutUrl;
    const provider = row.requestPayload.provider ?? receipt.provider;
    if (checkoutUrl)
      checkoutUrl = provider
        ? this.checkout.validateApprovalUrl(provider, checkoutUrl)
        : undefined;
    const safeChange = change
      ? { ...change, checkoutUrl: checkoutUrl ?? null }
      : undefined;
    return {
      ...receipt,
      ...(safeChange ? { planChange: safeChange } : {}),
      ...(row.requestPayload.provider
        ? { provider: row.requestPayload.provider }
        : {}),
      attemptId: row.id,
      operation: row.requestPayload.operation ?? 'checkout',
      status: processing ? 'processing' : row.status,
      planCode: row.requestPayload.planCode,
      planPriceCode: row.requestPayload.planPriceCode,
      statusFresh: receipt.statusFresh ?? false,
      ...(checkoutUrl ? { checkoutUrl } : { checkoutUrl: undefined }),
      ...(processing || row.status === 'pending'
        ? { retryAfterSeconds: 5 }
        : {}),
    };
  }
  async create(
    dto: CreatePaymentAttemptDto,
    actor: BillingServiceActor,
    permissions: string[],
  ): Promise<PaymentAttemptResponse> {
    const payload: CreatePaymentAttemptDto = {
      organizationId: dto.organizationId.toLowerCase(),
      userId: dto.userId.toLowerCase(),
      productCode: dto.productCode,
      idempotencyKey: dto.idempotencyKey.toLowerCase(),
      planCode: dto.planCode,
      planPriceCode: dto.planPriceCode,
      operation: dto.operation ?? 'checkout',
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      ...(dto.expectedSubscriptionId === undefined
        ? {}
        : { expectedSubscriptionId: dto.expectedSubscriptionId.toLowerCase() }),
      ...(dto.expectedAmountDueNow === undefined
        ? {}
        : { expectedAmountDueNow: dto.expectedAmountDueNow }),
      ...(dto.legalAcceptanceId === undefined
        ? {}
        : { legalAcceptanceId: dto.legalAcceptanceId.toLowerCase() }),
    };
    if (
      (payload.operation === 'change_plan') !==
      Boolean(payload.expectedSubscriptionId)
    )
      throw new BadRequestException(
        'Expected subscription is required only for plan changes',
      );
    this.assertOperation({ requestPayload: payload }, permissions);
    await this.policy.assertContext(
      actor,
      payload.productCode,
      payload.organizationId,
    );
    await this.policy.assertReturnUrls(
      actor,
      payload.successUrl,
      payload.cancelUrl,
    );
    const hash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    let previous = await this.find(
      this.dataSource.manager,
      payload.idempotencyKey,
    );
    if (!previous && payload.operation === 'change_plan') {
      try {
        // Domain reads use their own manager; keep them outside the attempt reservation transaction.
        const source = await this.subscriptions.getCurrentSubscription(
          payload.organizationId,
          payload.productCode,
        );
        if (source.id !== payload.expectedSubscriptionId)
          throw new ConflictException('SUBSCRIPTION_CHANGED');
      } catch (error) {
        // Another request may already have reserved the original intent while its source changed.
        previous = await this.find(
          this.dataSource.manager,
          payload.idempotencyKey,
        );
        if (!previous) throw error;
      }
    }
    if (previous) {
      this.assertOwner(previous, payload, actor);
      if (previous.requestHash !== hash)
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        ['billing.payment_attempt:' + payload.idempotencyKey],
      );
      const existing = await this.find(manager, payload.idempotencyKey, true);
      if (existing) {
        this.assertOwner(existing, payload, actor);
        if (existing.requestHash !== hash)
          throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
        return;
      }
      const repository = manager.getRepository(BillingPaymentAttemptEntity);
      await repository.save(
        repository.create({
          id: payload.idempotencyKey,
          organizationId: payload.organizationId,
          userId: payload.userId,
          productCode: payload.productCode,
          createdByIssuer: actor.issuer,
          createdByClientId: actor.clientId,
          requestHash: hash,
          requestPayload: {
            ...payload,
            provider: await this.resolveProvider(payload, actor, manager),
          },
          status: 'pending',
          receipt: {},
          leaseToken: null,
          leaseUntil: null,
        }),
      );
    });
    return this.retry(payload.idempotencyKey, payload, actor, permissions);
  }
  async get(
    id: string,
    context: PaymentAttemptContextDto,
    actor: BillingServiceActor,
  ): Promise<PaymentAttemptResponse> {
    const row = await this.owned(id, context, actor);
    if (row.status !== 'ready' || !row.receipt.checkoutId)
      return this.response(
        row,
        !!row.leaseUntil && row.leaseUntil.getTime() > Date.now(),
      );
    let status: Awaited<
      ReturnType<BillingCheckoutService['getCheckoutStatus']>
    >;
    try {
      status = await this.checkout.getCheckoutStatus(
        row.receipt.checkoutId,
        actor,
      );
    } catch {
      return {
        ...this.response(row),
        statusFresh: false,
        errorCode: 'BILLING_STATUS_UNAVAILABLE',
      };
    }
    if (
      row.requestPayload.provider &&
      status.provider !== row.requestPayload.provider
    )
      throw new ConflictException('Inconsistent payment attempt provider');
    if (status.subscriptionId !== row.receipt.subscriptionId)
      throw new ConflictException('Inconsistent payment attempt receipt');
    return this.dataSource.transaction(async (manager) => {
      const current = await this.find(manager, id, true);
      if (!current) throw new NotFoundException('Payment attempt not found');
      this.assertOwner(current, context, actor);
      // A concurrent confirmation wins over a stale status read.
      if (JSON.stringify(current.receipt) !== JSON.stringify(row.receipt))
        return this.response(current);
      // GET only projects authoritative stored state; it never verifies or captures a payment.
      current.receipt = {
        ...current.receipt,
        provider: status.provider,
        checkoutStatus: status.checkoutStatus,
        subscriptionStatus: status.subscriptionStatus,
        ...(status.planChange ? { planChange: status.planChange } : {}),
        statusCheckedAt: new Date().toISOString(),
        statusFresh: true,
      };
      await manager.getRepository(BillingPaymentAttemptEntity).save(current);
      return this.response(current);
    });
  }
  async retry(
    id: string,
    context: PaymentAttemptContextDto,
    actor: BillingServiceActor,
    permissions: string[],
  ): Promise<PaymentAttemptResponse> {
    const row = await this.owned(id, context, actor);
    this.assertOperation(row, permissions);
    if (row.status !== 'pending') return this.get(id, context, actor);
    await this.policy.assertReturnUrls(
      actor,
      row.requestPayload.successUrl,
      row.requestPayload.cancelUrl,
    );
    return this.execute(row, context, actor, false);
  }
  async confirm(
    id: string,
    context: PaymentAttemptContextDto,
    actor: BillingServiceActor,
  ): Promise<PaymentAttemptResponse> {
    const row = await this.owned(id, context, actor);
    if (
      row.requestPayload.operation !== 'change_plan' ||
      row.status !== 'ready' ||
      !row.receipt.checkoutId
    )
      throw new ConflictException('PLAN_CHANGE_NOT_READY');
    await this.policy.assertReturnUrls(
      actor,
      row.requestPayload.successUrl,
      row.requestPayload.cancelUrl,
    );
    return this.execute(row, context, actor, true);
  }
  async cancel(
    id: string,
    context: PaymentAttemptContextDto,
    actor: BillingServiceActor,
  ): Promise<{ cancelled: boolean; approvalUrl?: string }> {
    const initial = await this.owned(id, context, actor);
    if (initial.requestPayload.operation !== 'change_plan')
      throw new ConflictException('Only plan changes can be cancelled here');
    await this.policy.assertReturnUrls(
      actor,
      initial.requestPayload.successUrl,
      initial.requestPayload.cancelUrl,
    );
    const token = randomUUID();
    const claimed = await this.dataSource.transaction(async (manager) => {
      const row = await this.find(manager, id, true);
      if (!row) throw new NotFoundException('Payment attempt not found');
      this.assertOwner(row, context, actor);
      if (row.receipt.errorCode === 'PAYMENT_ATTEMPT_CANCELLED') return null;
      if (row.leaseUntil && row.leaseUntil.getTime() > Date.now())
        throw new ConflictException('Payment attempt is processing');
      row.leaseToken = token;
      row.leaseUntil = new Date(Date.now() + 60_000);
      await manager.getRepository(BillingPaymentAttemptEntity).save(row);
      return row;
    });
    if (!claimed) return { cancelled: true };
    try {
      if (!claimed.receipt.checkoutId)
        throw new ConflictException(
          'Payment attempt requires reconciliation before cancellation',
        );
      const result = claimed.receipt.checkoutId
        ? await this.subscriptions.cancelPlanChange(
            claimed.receipt.checkoutId,
            context.userId,
          )
        : { cancelled: true };
      await this.dataSource.transaction(async (manager) => {
        const row = await this.find(manager, id, true);
        if (!row || row.leaseToken !== token)
          throw new ConflictException('Cancellation lost its lease');
        row.leaseToken = null;
        row.leaseUntil = null;
        if (result.cancelled) {
          row.status = 'rejected';
          row.receipt = {
            ...row.receipt,
            checkoutUrl: undefined,
            checkoutStatus: 'cancelled',
            statusFresh: true,
            errorCode: 'PAYMENT_ATTEMPT_CANCELLED',
            ...(row.receipt.planChange
              ? {
                  planChange: {
                    ...row.receipt.planChange,
                    state: 'failed',
                    action: 'none',
                    checkoutUrl: null,
                  },
                }
              : {}),
          };
        }
        await manager.getRepository(BillingPaymentAttemptEntity).save(row);
      });
      return result;
    } catch (error) {
      await this.dataSource.transaction(async (manager) => {
        const row = await this.find(manager, id, true);
        if (row?.leaseToken === token) {
          row.leaseToken = null;
          row.leaseUntil = null;
          await manager.getRepository(BillingPaymentAttemptEntity).save(row);
        }
      });
      throw error;
    }
  }
  @Cron('*/1 * * * *', { name: 'central-payment-attempt-recovery' })
  async recoverPending(): Promise<void> {
    const rows = await this.dataSource
      .getRepository(BillingPaymentAttemptEntity)
      .find({
        where: { status: 'pending' },
        order: { updatedAt: 'ASC' },
        take: 25,
      });
    for (const row of rows) {
      if (row.leaseUntil && row.leaseUntil.getTime() > Date.now()) continue;
      const actor = {
        issuer: row.createdByIssuer,
        clientId: row.createdByClientId,
      };
      try {
        await this.policy.assertContext(
          actor,
          row.productCode,
          row.organizationId,
        );
        await this.policy.assertReturnUrls(
          actor,
          row.requestPayload.successUrl,
          row.requestPayload.cancelUrl,
        );
        await this.execute(row, row.requestPayload, actor, false);
      } catch {
        // Keep denied intents recoverable without starving the next batch.
        await this.dataSource
          .getRepository(BillingPaymentAttemptEntity)
          .update(row.id, { updatedAt: new Date() });
      }
    }
  }

  private async resolveProvider(
    dto: CreatePaymentAttemptDto,
    actor: BillingServiceActor,
    manager: EntityManager,
  ) {
    if (dto.operation !== 'change_plan')
      return this.checkout.resolveCheckoutProvider(dto, actor, manager);
    const subscription = await manager
      .getRepository(BillingSubscriptionEntity)
      .findOne({
        where: {
          id: dto.expectedSubscriptionId!,
          organizationId: dto.organizationId,
          productCode: dto.productCode,
        },
      });
    if (!subscription)
      throw new NotFoundException('Billing subscription not found');
    return subscription.provider;
  }

  private async execute(
    initial: BillingPaymentAttemptEntity,
    context: PaymentAttemptContextDto,
    actor: BillingServiceActor,
    confirm: boolean,
  ) {
    const token = randomUUID();
    const claimed = await this.dataSource.transaction(async (manager) => {
      const row = await this.find(manager, initial.id, true);
      if (!row) throw new NotFoundException('Payment attempt not found');
      this.assertOwner(row, context, actor);
      if (row.leaseUntil && row.leaseUntil.getTime() > Date.now()) return null;
      if (!confirm && row.status !== 'pending') return null;
      row.requestPayload.provider ??= await this.resolveProvider(
        row.requestPayload,
        actor,
        manager,
      );
      row.leaseToken = token;
      row.leaseUntil = new Date(Date.now() + 60_000);
      await manager.getRepository(BillingPaymentAttemptEntity).save(row);
      return row;
    });
    if (!claimed) {
      const current = await this.owned(initial.id, context, actor);
      return this.response(
        current,
        !!current.leaseUntil && current.leaseUntil.getTime() > Date.now(),
      );
    }
    let receipt: Partial<PaymentAttemptResponse> | undefined;
    let failure: unknown;
    try {
      const dto = claimed.requestPayload;
      if (confirm) {
        const checked = await this.subscriptions.verifyCheckoutSession(
          claimed.receipt.checkoutId!,
        );
        if (checked.subscriptionId !== claimed.receipt.subscriptionId)
          throw new ConflictException('Inconsistent payment attempt receipt');
        receipt = {
          checkoutStatus: checked.checkoutStatus,
          subscriptionStatus: checked.subscriptionStatus,
          ...(checked.planChange ? { planChange: checked.planChange } : {}),
          ...(checked.checkoutUrl ? { checkoutUrl: checked.checkoutUrl } : {}),
          statusFresh: true,
          statusCheckedAt: new Date().toISOString(),
        };
      } else if (dto.operation === 'change_plan') {
        const changed = await this.subscriptions.changePlan(
          dto.expectedSubscriptionId!,
          {
            idempotencyKey: dto.idempotencyKey,
            actorUserId: dto.userId,
            targetPlanCode: dto.planCode,
            targetPlanPriceCode: dto.planPriceCode,
            expectedAmountDueNow: dto.expectedAmountDueNow,
            legalAcceptanceId: dto.legalAcceptanceId,
            successUrl: dto.successUrl,
            cancelUrl: dto.cancelUrl,
          },
          actor,
        );
        receipt = {
          checkoutId: changed.checkoutId,
          subscriptionId: changed.newSubscriptionId,
          checkoutUrl: changed.checkoutUrl,
          checkoutStatus: 'created',
          subscriptionStatus: changed.subscription.status,
          ...(changed.planChange ? { planChange: changed.planChange } : {}),
          statusFresh: false,
        };
      } else {
        const result = await this.checkout.createCheckoutSession(
          {
            idempotencyKey: dto.idempotencyKey,
            organizationId: dto.organizationId,
            userId: dto.userId,
            productCode: dto.productCode,
            planCode: dto.planCode,
            planPriceCode: dto.planPriceCode,
            provider: dto.provider!,
            legalAcceptanceId: dto.legalAcceptanceId,
            successUrl: dto.successUrl,
            cancelUrl: dto.cancelUrl,
          },
          actor,
        );
        receipt = {
          checkoutId: result.checkoutId,
          subscriptionId: result.subscriptionId,
          checkoutUrl: result.checkoutUrl,
          checkoutStatus: result.status,
          statusFresh: false,
        };
      }
    } catch (error) {
      failure = error;
    }
    return this.dataSource.transaction(async (manager) => {
      const row = await this.find(manager, initial.id, true);
      if (!row) throw new NotFoundException('Payment attempt not found');
      this.assertOwner(row, context, actor);
      if (row.leaseToken !== token)
        return this.response(row, row.status === 'pending');
      row.leaseToken = null;
      row.leaseUntil = null;
      if (receipt) {
        row.status = 'ready';
        row.receipt = { ...row.receipt, ...receipt, errorCode: undefined };
      } else {
        const status =
          failure instanceof HttpException ? failure.getStatus() : 503;
        const uncertain =
          confirm ||
          [401, 403, 408, 429].includes(status) ||
          status >= 500 ||
          failure instanceof CheckoutInProgressException;
        if (!uncertain) row.status = 'rejected';
        row.receipt = {
          ...row.receipt,
          statusFresh: false,
          errorCode:
            failure instanceof CheckoutInProgressException
              ? 'CHECKOUT_IN_PROGRESS'
              : uncertain
                ? 'BILLING_TEMPORARILY_UNAVAILABLE'
                : 'BILLING_CHECKOUT_REJECTED',
        };
      }
      await manager.getRepository(BillingPaymentAttemptEntity).save(row);
      return this.response(row, failure instanceof CheckoutInProgressException);
    });
  }
}
