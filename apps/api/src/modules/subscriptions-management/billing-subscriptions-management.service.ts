import { isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { Cron } from '@nestjs/schedule';
import {
  BadGatewayException,
  ConflictException,
  Logger,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { BillingAuditService } from '../audit';
import { BillingPlanCatalogResolver } from '../catalog';
import { BillingCheckoutService } from '../checkout';
import { BillingEntitlementsService } from '../entitlements';
import {
  BillingCheckoutSessionEntity,
  BillingPaymentEntity,
  PaymentStatus,
  BillingLicenseEntity,
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import {
  BillingCheckoutSessionStatus,
  BillingPlanStatus,
  LicenseStatus,
  SubscriptionStatus,
} from '../billing-shared';
import { BillingLicenseCalculatorService } from '../licenses';
import { BillingProviderRegistry } from '../providers/billing-provider.registry';
import {
  CancelSubscriptionDto,
  ChangePlanDto,
  ChangePlanResponseDto,
  VerifyCheckoutSessionResponseDto,
} from './dtos';
import { SubscriptionManagementMapper } from './mappers';
import {
  applyConfirmedPlanChange,
  cancellationIntent,
  hasPaidCancellationAccess,
  pendingPlanChange,
  type CancellationIntent,
  type PendingPlanChange,
} from './subscription-management-state';
import type { BillingServiceActor } from '../../common/types/billing-service-authorization.type';

import {
  calculatePlanChangeQuote,
  cents,
  PlanChangeQuote,
} from './plan-change-quote';

const CURRENT_STATUS_PRIORITY = [
  SubscriptionStatus.Active,
  SubscriptionStatus.PastDue,
  SubscriptionStatus.Cancelled,
  SubscriptionStatus.Pending,
];

const TERMINAL_STATUSES = [
  SubscriptionStatus.Cancelled,
  SubscriptionStatus.Expired,
];

@Injectable()
export class BillingSubscriptionsManagementService {
  private readonly logger = new Logger(
    BillingSubscriptionsManagementService.name,
  );
  constructor(
    private readonly dataSource: DataSource,
    private readonly checkout: BillingCheckoutService,
    private readonly entitlements: BillingEntitlementsService,
    private readonly providers: BillingProviderRegistry,
    private readonly licenseCalculator: BillingLicenseCalculatorService,
    private readonly audit: BillingAuditService,
    private readonly planResolver: BillingPlanCatalogResolver,
    @InjectRepository(BillingSubscriptionEntity)
    private readonly subscriptions: Repository<BillingSubscriptionEntity>,
    @InjectRepository(BillingPlanEntity)
    private readonly plans: Repository<BillingPlanEntity>,
    @InjectRepository(BillingCheckoutSessionEntity)
    private readonly checkoutSessions: Repository<BillingCheckoutSessionEntity>,
  ) {}

  async getCurrentSubscription(organizationId: string, productCode: string) {
    const candidates = await this.subscriptions.find({
      where: {
        organizationId,
        productCode,
        status: In(CURRENT_STATUS_PRIORITY),
      },
      relations: {
        plan: {
          versions: {
            prices: { providerPrices: true },
            entitlements: { feature: true },
          },
        },
        planPrice: true,
        providerPrice: true,
      },
      order: { updatedAt: 'DESC' },
    });

    const subscription = candidates
      .filter(
        (item) =>
          item.status !== SubscriptionStatus.Cancelled ||
          hasPaidCancellationAccess(item),
      )
      .sort(
        (left, right) =>
          CURRENT_STATUS_PRIORITY.indexOf(left.status) -
            CURRENT_STATUS_PRIORITY.indexOf(right.status) ||
          right.updatedAt.getTime() - left.updatedAt.getTime(),
      )[0];

    if (!subscription) {
      throw new NotFoundException('Current billing subscription not found');
    }

    return this.toResponse(subscription);
  }

  async quotePlanChange(
    subscriptionId: string,
    targetCode: string,
    targetPriceCode: string,
  ): Promise<PlanChangeQuote> {
    const subscription = await this.findSubscription(subscriptionId);
    this.providers.get(subscription.provider);
    const pending = pendingPlanChange(subscription);
    if (
      pending?.quote &&
      pending.targetPlanCode === targetCode &&
      pending.targetPlanPriceCode === targetPriceCode &&
      !['effective', 'failed'].includes(pending.state)
    )
      return pending.quote;
    if (
      subscription.status !== SubscriptionStatus.Active ||
      subscription.cancelAtPeriodEnd ||
      subscription.metadata.refundRevocation
    )
      throw new BadRequestException(
        'An active renewing subscription is required',
      );
    const targetPlan = await this.findTargetPlan(
      subscription,
      targetCode,
      targetPriceCode,
    );
    const target = this.planResolver.resolve(
      targetPlan,
      subscription.provider,
      targetPriceCode,
    );
    const current =
      subscription.planPrice ??
      this.planResolver.activePrice(
        this.planResolver.contractVersion(subscription),
        subscription.planPriceCode ?? undefined,
      );
    return calculatePlanChangeQuote(subscription, current, target.price);
  }

  async cancelSubscription(subscriptionId: string, dto: CancelSubscriptionDto) {
    let source = await this.findSubscription(subscriptionId);
    this.providers.get(source.provider);
    const capture = pendingPlanChange(source);
    if (
      capture &&
      !capture.proration?.refundedAt &&
      ((capture.captureAttemptedAt && !capture.captureId) ||
        (capture.captureId && capture.state !== 'effective'))
    ) {
      await this.reconcileRevision(subscriptionId, true);
      source = await this.findSubscription(subscriptionId);
      const unresolved = pendingPlanChange(source);
      if (
        unresolved &&
        !unresolved.proration?.refundedAt &&
        ((unresolved.captureAttemptedAt && !unresolved.captureId) ||
          (unresolved.captureId && unresolved.state !== 'effective'))
      )
        throw new ConflictException(
          'Payment confirmation is pending; retry cancellation',
        );
    }
    const selectedId = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [
          `billing.cancel:${source.organizationId}:${source.productCode}:${dto.idempotencyKey}`,
        ],
      );
      const previous = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM subscriptions WHERE organization_id=$1 AND product_code=$2 AND metadata #>> '{cancellation,idempotencyKey}'=$3 AND deleted_at IS NULL`,
        [source.organizationId, source.productCode, dto.idempotencyKey],
      );
      const subscription = await this.lockSubscription(
        manager,
        previous[0]?.id ?? subscriptionId,
      );
      const ongoing = pendingPlanChange(subscription);
      if (ongoing?.leaseUntil && Date.parse(ongoing.leaseUntil) > Date.now())
        throw new ConflictException(
          'Plan change confirmation in progress; retry cancellation',
        );
      // Captured money must reach its contracted benefits before cancellation can retire the intent.
      if (
        ongoing &&
        !ongoing.proration?.refundedAt &&
        ((ongoing.captureAttemptedAt && !ongoing.captureId) ||
          (ongoing.captureId && ongoing.state !== 'effective'))
      )
        throw new ConflictException(
          'Paid upgrade confirmation is pending; retry cancellation',
        );
      const prior = cancellationIntent(subscription);
      if (prior) {
        if (
          prior.idempotencyKey !== dto.idempotencyKey ||
          prior.actorUserId !== dto.actorUserId ||
          prior.reason !== (dto.reason ?? null)
        )
          throw new ConflictException(
            'Cancellation request differs from its original intent',
          );
        return subscription.id;
      }
      if (
        TERMINAL_STATUSES.includes(subscription.status) ||
        subscription.metadata.refundRevocation
      )
        throw new BadRequestException(
          'Billing subscription is already terminal',
        );
      const end = subscription.currentPeriodEnd ?? subscription.nextBillingTime;
      const intent: CancellationIntent = {
        idempotencyKey: dto.idempotencyKey,
        actorUserId: dto.actorUserId,
        reason: dto.reason ?? null,
        state: 'pending',
        requestedAt: new Date().toISOString(),
        effectiveAt: end?.toISOString() ?? null,
      };
      const change = pendingPlanChange(subscription);
      if (change && change.state !== 'effective') {
        change.state = 'failed';
        if (change.checkoutId) {
          const checkoutRepo = manager.getRepository(
            BillingCheckoutSessionEntity,
          );
          const checkout = await checkoutRepo.findOne({
            where: { id: change.checkoutId },
          });
          if (checkout) {
            checkout.status = BillingCheckoutSessionStatus.Cancelled;
            checkout.metadata = {
              ...checkout.metadata,
              planChangeState: 'failed',
              planChangeEffectiveAt: change.effectiveAt,
            };
            await checkoutRepo.save(checkout);
          }
        }
      }
      const correction = this.asRecord(
        subscription.metadata.renewalPlanCorrection,
      );
      subscription.cancelAtPeriodEnd = true;
      subscription.metadata = {
        ...subscription.metadata,
        ...(correction?.state === 'awaiting_approval'
          ? {
              renewalPlanCorrection: {
                ...correction,
                state: 'cancelled',
                cancelledAt: new Date().toISOString(),
              },
            }
          : {}),
        cancellation: intent,
        ...(change ? { pendingPlanChange: change } : {}),
      };
      await manager.getRepository(BillingSubscriptionEntity).save(subscription);
      await this.upsertLicense(
        manager,
        subscription,
        this.mapLicenseStatus(subscription.status) ?? LicenseStatus.Active,
      );
      await this.audit.record({
        manager,
        organizationId: subscription.organizationId,
        actorUserId: dto.actorUserId,
        action: 'billing.subscription.cancellation_requested',
        resourceType: 'billing_subscription',
        resourceId: subscription.id,
        provider: subscription.provider,
        metadata: { subscriptionId: subscription.id, newStatus: 'pending' },
      });
      return subscription.id;
    });
    await this.reconcileCancellation(selectedId);
    return this.toResponse(await this.findSubscription(selectedId));
  }

  async changePlan(
    subscriptionId: string,
    dto: ChangePlanDto,
    actor: BillingServiceActor,
  ): Promise<ChangePlanResponseDto> {
    let subscription = await this.findSubscription(subscriptionId);
    if (
      this.asRecord(subscription.metadata.renewalPlanCorrection)?.state ===
      'awaiting_approval'
    )
      throw new ConflictException(
        'Renewal plan correction requires confirmation first',
      );
    this.providers.get(subscription.provider);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          actor.issuer,
          actor.clientId,
          dto.actorUserId,
          dto.targetPlanCode,
          dto.targetPlanPriceCode,
          dto.expectedAmountDueNow ?? null,
          dto.legalAcceptanceId ?? null,
          dto.successUrl,
          dto.cancelUrl,
          dto.billingEmail ?? null,
        ]),
      )
      .digest('hex');
    let change = pendingPlanChange(subscription);
    const historical = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM checkout_sessions WHERE organization_id=$1 AND product_code=$2 AND metadata->>'idempotencyKey'=$3 AND metadata->>'createdByIssuer'=$4 AND metadata->>'createdByClientId'=$5 AND deleted_at IS NULL`,
      [
        subscription.organizationId,
        subscription.productCode,
        dto.idempotencyKey,
        actor.issuer,
        actor.clientId,
      ],
    );
    if (historical[0] && historical[0].id !== change?.checkoutId) {
      const receipt = await this.checkoutSessions.findOne({
        where: { id: historical[0].id },
      });
      if (
        !receipt ||
        receipt.metadata.operation !== 'plan_change' ||
        receipt.metadata.subscriptionId !== subscriptionId ||
        receipt.metadata.managementRequestHash !== requestHash
      )
        throw new ConflictException(
          'Idempotency key is bound to another request',
        );
      const state = receipt.metadata.planChangeState;
      if (!['scheduled', 'effective'].includes(String(state)))
        throw new ConflictException(
          'Historical plan change cannot be restarted; create a new request',
        );
      return {
        subscription: await this.toResponse(subscription),
        checkoutId: receipt.id,
        newSubscriptionId: subscription.id,
        checkoutUrl: receipt.successUrl,
        targetPlanCode: String(receipt.metadata.targetPlanCode),
        effectiveAt: String(receipt.metadata.planChangeEffectiveAt),
        state: state as 'scheduled' | 'effective',
      };
    }
    if (change?.idempotencyKey === dto.idempotencyKey) {
      if (change.requestHash !== requestHash)
        throw new ConflictException(
          'Plan change request differs from its original intent',
        );
    } else {
      if (
        !subscription.providerSubscriptionId ||
        subscription.status !== SubscriptionStatus.Active ||
        subscription.cancelAtPeriodEnd ||
        subscription.metadata.refundRevocation
      )
        throw new BadRequestException(
          'An active renewing subscription is required',
        );
      if (change && !['effective', 'failed'].includes(change.state))
        throw new ConflictException('Another plan change is pending');
      const end = subscription.currentPeriodEnd ?? subscription.nextBillingTime;
      if (!end || end.getTime() <= Date.now())
        throw new BadRequestException(
          'A confirmed future billing boundary is required',
        );
      const quote = await this.quotePlanChange(
        subscriptionId,
        dto.targetPlanCode,
        dto.targetPlanPriceCode,
      );
      if (
        (quote.kind === 'upgrade' && dto.expectedAmountDueNow === undefined) ||
        (dto.expectedAmountDueNow !== undefined &&
          cents(quote.amountDueNow) > cents(dto.expectedAmountDueNow))
      )
        throw new ConflictException(
          'Proration quote changed; review the updated amount',
        );
      const targetPlan = await this.findTargetPlan(
        subscription,
        dto.targetPlanCode,
        dto.targetPlanPriceCode,
      );
      const sourcePlanPriceId = subscription.planPriceId;
      const checkout = await this.checkout.preparePlanRevision(
        subscription,
        targetPlan,
        {
          idempotencyKey: dto.idempotencyKey,
          organizationId: subscription.organizationId,
          userId: dto.actorUserId,
          productCode: subscription.productCode,
          planCode: targetPlan.code,
          planPriceCode: dto.targetPlanPriceCode,
          provider: subscription.provider,
          legalAcceptanceId: dto.legalAcceptanceId,
          successUrl: dto.successUrl,
          cancelUrl: dto.cancelUrl,
          billingEmail: dto.billingEmail,
        },
        actor,
        end.toISOString(),
      );
      await this.checkoutSessions.update(checkout.id, {
        metadata: {
          ...checkout.metadata,
          managementRequestHash: requestHash,
          targetPlanCode: dto.targetPlanCode,
          planChangeQuote: quote,
        },
      });
      await this.dataSource.transaction(async (manager) => {
        subscription = await this.lockSubscription(manager, subscriptionId);
        if (
          this.asRecord(subscription.metadata.renewalPlanCorrection)?.state ===
          'awaiting_approval'
        )
          throw new ConflictException(
            'Renewal plan correction requires confirmation first',
          );
        const current = pendingPlanChange(subscription);
        if (current?.idempotencyKey === dto.idempotencyKey) {
          if (current.requestHash !== requestHash)
            throw new ConflictException(
              'Plan change request differs from its original intent',
            );
          return;
        }
        if (current && !['effective', 'failed'].includes(current.state))
          throw new ConflictException('Another plan change is pending');
        if (
          subscription.cancelAtPeriodEnd ||
          subscription.metadata.refundRevocation ||
          subscription.status !== SubscriptionStatus.Active
        )
          throw new ConflictException(
            'Subscription changed while preparing revision',
          );
        if (subscription.planPriceId !== sourcePlanPriceId)
          throw new ConflictException('Contract changed; refresh the quote');
        if (
          (
            subscription.currentPeriodEnd ?? subscription.nextBillingTime
          )?.toISOString() !== quote.nextBillingAt ||
          Date.parse(quote.nextBillingAt) <= Date.now()
        )
          throw new ConflictException(
            'Billing period changed; refresh the quote',
          );
        const intent: PendingPlanChange = {
          idempotencyKey: dto.idempotencyKey,
          requestHash,
          state: 'preparing',
          quote,
          targetPlanCode: dto.targetPlanCode,
          targetPlanPriceCode: dto.targetPlanPriceCode,
          targetProviderPlanId: String(
            checkout.metadata.providerPlanId ?? checkout.metadata.paypalPlanId,
          ),
          effectiveAt: String(checkout.metadata.effectiveAt),
          requestedEffectiveAt: String(checkout.metadata.effectiveAt),
          checkoutId: checkout.id,
          newSubscriptionId: subscription.id,
          requestedAt: new Date().toISOString(),
        };
        subscription.metadata = {
          ...subscription.metadata,
          pendingPlanChange: intent,
        };
        await manager
          .getRepository(BillingSubscriptionEntity)
          .save(subscription);
        await this.audit.record({
          manager,
          organizationId: subscription.organizationId,
          actorUserId: dto.actorUserId,
          action: 'billing.subscription.plan_change_requested',
          resourceType: 'billing_subscription',
          resourceId: subscription.id,
          metadata: {
            subscriptionId: subscription.id,
            checkoutSessionId: checkout.id,
            targetPlanCode: dto.targetPlanCode,
          },
        });
      });
    }
    await this.reconcileRevision(subscriptionId, true);
    subscription = await this.findSubscription(subscriptionId);
    change = pendingPlanChange(subscription);
    if (!change || change.state === 'failed')
      throw new ConflictException(
        'Plan change did not complete; the original subscription remains in place',
      );
    const checkout = await this.checkoutSessions.findOne({
      where: { id: change.checkoutId },
    });
    if (!checkout)
      throw new BadGatewayException(
        'Plan change confirmation is pending; retry the same idempotency key',
      );
    const planChange = this.checkout.planChangeResponse(
      checkout.provider,
      change,
      checkout.providerCheckoutUrl,
    );
    if (planChange.action !== 'none' && !planChange.checkoutUrl)
      throw new BadGatewayException(
        'Plan change confirmation is pending; retry the same idempotency key',
      );
    return {
      subscription: await this.toResponse(subscription),
      checkoutId: checkout.id,
      newSubscriptionId: subscription.id,
      checkoutUrl: planChange.checkoutUrl ?? checkout.successUrl,
      planChange,
      targetPlanCode: change.targetPlanCode,
      effectiveAt:
        change.quote?.kind === 'upgrade' && change.state === 'awaiting_approval'
          ? change.quote.effectiveAt
          : change.effectiveAt,
      state:
        change.state === 'effective'
          ? 'effective'
          : change.state === 'scheduled'
            ? 'scheduled'
            : 'awaiting_approval',
    };
  }

  async cancelPlanChange(
    checkoutId: string,
    actorUserId?: string,
  ): Promise<{ cancelled: boolean; approvalUrl?: string }> {
    const checkout = await this.checkoutSessions.findOne({
      where: { id: checkoutId },
    });
    if (!checkout || checkout.metadata.operation !== 'plan_change')
      throw new NotFoundException('Plan change checkout not found');
    const subscriptionId = this.stringOrNull(checkout.metadata.subscriptionId);
    if (!subscriptionId)
      throw new NotFoundException('Plan change subscription not found');
    const token = randomUUID();
    const claimed = await this.dataSource.transaction(async (manager) => {
      const subscription = await this.lockSubscription(manager, subscriptionId);
      const change = pendingPlanChange(subscription);
      if (change?.checkoutId !== checkoutId) {
        if (checkout.metadata.planChangeState === 'failed') return null;
        throw new ConflictException('Plan change has been replaced');
      }
      if (change.state === 'failed') return null;
      if (
        change.state === 'effective' ||
        change.captureId ||
        change.captureAttemptedAt
      )
        throw new ConflictException(
          'Payment requires reconciliation before cancelling the change',
        );
      if (change.leaseUntil && Date.parse(change.leaseUntil) > Date.now())
        throw new ConflictException('Plan change confirmation is in progress');
      if (
        !subscription.providerSubscriptionId ||
        subscription.status !== SubscriptionStatus.Active ||
        cancellationIntent(subscription)
      )
        throw new ConflictException(
          'Subscription cannot cancel this plan change',
        );
      change.cancelRequestedAt ??= new Date().toISOString();
      change.leaseToken = token;
      change.leaseUntil = new Date(Date.now() + 60_000).toISOString();
      subscription.metadata = {
        ...subscription.metadata,
        pendingPlanChange: change,
      };
      await manager.getRepository(BillingSubscriptionEntity).save(subscription);
      return subscription;
    });
    if (!claimed) return { cancelled: true };
    const intent = pendingPlanChange(claimed)!;
    let paymentNeedsReconciliation = false;
    try {
      const adapter = this.providers.get(claimed.provider);
      if (intent.paymentOrderId) {
        try {
          const order = await adapter.getOrder(intent.paymentOrderId);
          if (
            order.status === 'completed' ||
            order.status === 'approved' ||
            order.units.some((unit) => unit.captures.length > 0)
          ) {
            paymentNeedsReconciliation = true;
            throw new ConflictException(
              'Payment requires reconciliation before cancelling the change',
            );
          }
        } catch (error) {
          if (
            !(error instanceof NotFoundException) ||
            !intent.paymentQuoteExpiresAt ||
            Date.now() < Date.parse(intent.paymentQuoteExpiresAt)
          )
            throw error;
        }
      }
      const originalPlanId = claimed.providerPrice?.providerPriceId;
      if (!originalPlanId)
        throw new ConflictException('Original provider plan is unavailable');
      let provider = await adapter.getSubscription(
        claimed.providerSubscriptionId!,
      );
      if (provider.subscriptionStatus !== SubscriptionStatus.Active)
        throw new ConflictException(
          'Provider subscription requires reconciliation',
        );
      let approvalUrl = intent.cancelApprovalUrl;
      if (provider.planId !== originalPlanId) {
        if (provider.planId !== intent.targetProviderPlanId)
          throw new ConflictException('Provider subscription plan changed');
        if (!approvalUrl) {
          const revision = await adapter.reviseSubscription({
            providerSubscriptionId: claimed.providerSubscriptionId!,
            providerPlanId: originalPlanId,
            requestId: createHash('sha256')
              .update(checkoutId + ':cancel-plan-change')
              .digest('hex')
              .slice(0, 32),
            returnUrl: checkout.successUrl,
            cancelUrl: checkout.cancelUrl,
          });
          approvalUrl = revision.approvalUrl;
          provider = await adapter.getSubscription(
            claimed.providerSubscriptionId!,
          );
        }
      }
      const cancelled =
        provider.planId === originalPlanId &&
        provider.subscriptionStatus === SubscriptionStatus.Active;
      if (!cancelled && !approvalUrl)
        throw new BadGatewayException(
          'Provider cancellation approval is unavailable',
        );
      if (approvalUrl) approvalUrl = adapter.validateApprovalUrl(approvalUrl);
      await this.dataSource.transaction(async (manager) => {
        const subscription = await this.lockSubscription(
          manager,
          subscriptionId,
        );
        const change = pendingPlanChange(subscription);
        if (
          change?.checkoutId !== checkoutId ||
          change.leaseToken !== token ||
          change.captureId ||
          change.captureAttemptedAt
        )
          throw new ConflictException(
            'Plan change cancellation lost its lease',
          );
        delete change.leaseToken;
        delete change.leaseUntil;
        if (approvalUrl) change.cancelApprovalUrl = approvalUrl;
        if (cancelled) {
          change.state = 'failed';
          await manager
            .getRepository(BillingCheckoutSessionEntity)
            .update(checkoutId, {
              status: BillingCheckoutSessionStatus.Cancelled,
              providerCheckoutUrl: null,
              metadata: {
                ...checkout.metadata,
                planChangeState: 'failed',
                planChangeEffectiveAt: change.effectiveAt,
              },
            });
          await this.audit.record({
            manager,
            organizationId: subscription.organizationId,
            actorUserId,
            action: 'billing.subscription.plan_change_cancelled',
            resourceType: 'billing_subscription',
            resourceId: subscription.id,
            metadata: { checkoutSessionId: checkoutId },
          });
        }
        subscription.metadata = {
          ...subscription.metadata,
          pendingPlanChange: change,
        };
        await manager
          .getRepository(BillingSubscriptionEntity)
          .save(subscription);
      });
      return cancelled
        ? { cancelled: true }
        : { cancelled: false, approvalUrl };
    } catch (error) {
      await this.dataSource.transaction(async (manager) => {
        const subscription = await this.lockSubscription(
          manager,
          subscriptionId,
        );
        const change = pendingPlanChange(subscription);
        if (change?.checkoutId === checkoutId && change.leaseToken === token) {
          delete change.leaseToken;
          delete change.leaseUntil;
          if (paymentNeedsReconciliation) {
            delete change.cancelRequestedAt;
            delete change.cancelApprovalUrl;
          }
          subscription.metadata = {
            ...subscription.metadata,
            pendingPlanChange: change,
          };
          await manager
            .getRepository(BillingSubscriptionEntity)
            .save(subscription);
        }
      });
      throw error;
    }
  }

  async reconcileRenewalPlanCorrection(id: string): Promise<boolean> {
    const source = await this.findSubscription(id);
    const expected = this.asRecord(source.metadata.renewalPlanCorrection);
    if (expected?.state === 'effective') return true;
    if (expected?.state !== 'awaiting_approval') return false;
    if (
      !source.providerSubscriptionId ||
      source.status !== SubscriptionStatus.Active ||
      source.cancelAtPeriodEnd ||
      cancellationIntent(source) ||
      source.metadata.refundRevocation
    )
      throw new ConflictException(
        'Renewal correction requires an active subscription',
      );
    const provider = await this.providers
      .get(source.provider)
      .getSubscription(source.providerSubscriptionId);
    if (
      provider.id !== source.providerSubscriptionId ||
      provider.subscriptionStatus !== SubscriptionStatus.Active ||
      provider.planId !== expected.targetProviderPlanId
    )
      return false;
    return this.dataSource.transaction(async (manager) => {
      const subscription = await this.lockSubscription(manager, id);
      const correction = this.asRecord(
        subscription.metadata.renewalPlanCorrection,
      );
      if (correction?.state === 'effective') return true;
      if (
        correction?.state !== 'awaiting_approval' ||
        correction.requestId !== expected.requestId ||
        correction.targetProviderPlanId !== expected.targetProviderPlanId ||
        subscription.providerSubscriptionId !== source.providerSubscriptionId ||
        subscription.provider !== source.provider
      )
        throw new ConflictException(
          'Renewal correction changed during verification',
        );
      for (const key of [
        'requestId',
        'sourcePlanPriceId',
        'sourceProviderPriceId',
        'targetPlanPriceId',
        'targetProviderPriceId',
        'targetProviderPlanId',
        'requestedAt',
      ])
        if (typeof correction[key] !== 'string' || !correction[key])
          throw new ConflictException(
            'Renewal correction metadata is incomplete',
          );
      const change = pendingPlanChange(subscription);
      if (
        subscription.status !== SubscriptionStatus.Active ||
        subscription.cancelAtPeriodEnd ||
        cancellationIntent(subscription) ||
        subscription.metadata.refundRevocation ||
        (change && !['effective', 'failed'].includes(change.state))
      )
        throw new ConflictException(
          'Subscription changed during renewal correction',
        );
      const atSource =
        subscription.planPriceId === correction.sourcePlanPriceId &&
        subscription.providerPriceId === correction.sourceProviderPriceId;
      const atTarget =
        subscription.planPriceId === correction.targetPlanPriceId &&
        subscription.providerPriceId === correction.targetProviderPriceId;
      if (!atSource && !atTarget)
        throw new ConflictException(
          'Renewal correction source contract changed',
        );
      const prices = manager.getRepository(BillingPlanPriceEntity);
      const originalPrice = await prices.findOne({
        where: { id: String(correction.sourcePlanPriceId) },
        relations: {
          planVersion: { plan: true, entitlements: true },
          providerPrices: true,
        },
      });
      const targetPrice = await prices.findOne({
        where: { id: String(correction.targetPlanPriceId) },
        relations: {
          planVersion: { plan: true, entitlements: true },
          providerPrices: true,
        },
      });
      const originalProvider = originalPrice?.providerPrices?.find(
        (price) => price.id === correction.sourceProviderPriceId,
      );
      const targetProvider = targetPrice?.providerPrices?.find(
        (price) => price.id === correction.targetProviderPriceId,
      );
      if (
        !originalPrice ||
        !targetPrice ||
        !originalProvider ||
        !targetProvider ||
        originalPrice.planVersion.planId !== subscription.planId ||
        targetPrice.planVersion.planId !== subscription.planId ||
        targetPrice.planVersion.plan.productId !==
          subscription.plan.productId ||
        originalPrice.currency !== targetPrice.currency ||
        cents(originalPrice.amount) !== cents(targetPrice.amount) ||
        originalPrice.billingInterval !== targetPrice.billingInterval ||
        originalPrice.billingIntervalCount !==
          targetPrice.billingIntervalCount ||
        originalProvider.provider !== subscription.provider ||
        targetProvider.provider !== subscription.provider ||
        targetProvider.providerPriceId !== correction.targetProviderPlanId
      )
        throw new ConflictException(
          'Renewal correction must preserve the existing contract terms',
        );
      const entitlements = (price: BillingPlanPriceEntity) =>
        (price.planVersion.entitlements ?? [])
          .map(({ featureId, valueJson }) => ({ featureId, valueJson }))
          .sort((left, right) => left.featureId.localeCompare(right.featureId));
      if (
        !isDeepStrictEqual(
          entitlements(originalPrice),
          entitlements(targetPrice),
        )
      )
        throw new ConflictException(
          'Renewal correction must preserve contracted entitlements',
        );
      subscription.planPriceId = targetPrice.id;
      subscription.planPrice = targetPrice;
      subscription.planPriceCode = targetPrice.code;
      subscription.providerPriceId = targetProvider.id;
      subscription.providerPrice = targetProvider;
      subscription.metadata = {
        ...subscription.metadata,
        renewalPlanCorrection: {
          ...correction,
          state: 'effective',
          confirmedAt: new Date().toISOString(),
        },
      };
      await manager.getRepository(BillingSubscriptionEntity).save(subscription);
      await this.audit.record({
        manager,
        organizationId: subscription.organizationId,
        action: 'billing.subscription.renewal_plan_corrected',
        resourceType: 'billing_subscription',
        resourceId: subscription.id,
        metadata: {
          requestId: correction.requestId,
          sourcePlanPriceId: correction.sourcePlanPriceId,
          targetPlanPriceId: targetPrice.id,
          targetProviderPlanId: targetProvider.providerPriceId,
        },
      });
      return true;
    });
  }

  // Intents survive API timeouts and process restarts; remote I/O never holds a DB transaction.
  @Cron('*/1 * * * *', { name: 'subscription-management-recovery' })
  async recoverManagement(): Promise<void> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM subscriptions WHERE deleted_at IS NULL AND (metadata #>> '{cancellation,state}'='pending' OR metadata #>> '{pendingPlanChange,state}' IN ('preparing','awaiting_approval','scheduled') OR metadata #>> '{renewalPlanCorrection,state}'='awaiting_approval') ORDER BY updated_at LIMIT 25`,
    );
    for (const row of rows) {
      try {
        const subscription = await this.findSubscription(row.id);
        if (cancellationIntent(subscription)?.state === 'pending')
          await this.reconcileCancellation(row.id);
        else if (
          this.asRecord(subscription.metadata.renewalPlanCorrection)?.state ===
          'awaiting_approval'
        )
          await this.reconcileRenewalPlanCorrection(row.id);
        else await this.reconcileRevision(row.id, false);
      } catch {
        this.logger.warn({
          event: 'subscription_management_recovery_pending',
          subscriptionId: row.id,
        });
      }
    }
  }

  private async lockSubscription(
    manager: EntityManager,
    id: string,
  ): Promise<BillingSubscriptionEntity> {
    const subscription = await manager
      .getRepository(BillingSubscriptionEntity)
      .findOne({
        where: { id },
        relations: {
          plan: {
            versions: {
              prices: { providerPrices: true },
              entitlements: { feature: true },
            },
          },
          planPrice: true,
          providerPrice: true,
        },
        lock: { mode: 'pessimistic_write', tables: ['subscriptions'] },
      });
    if (!subscription)
      throw new NotFoundException('Billing subscription not found');
    return subscription;
  }

  private async reconcileCancellation(id: string): Promise<void> {
    const token = randomUUID();
    const claimed = await this.dataSource.transaction(async (manager) => {
      const subscription = await this.lockSubscription(manager, id);
      const intent = cancellationIntent(subscription);
      if (
        !intent ||
        intent.state === 'scheduled' ||
        (intent.leaseUntil && Date.parse(intent.leaseUntil) > Date.now())
      )
        return null;
      intent.leaseToken = token;
      intent.leaseUntil = new Date(Date.now() + 60_000).toISOString();
      subscription.metadata = {
        ...subscription.metadata,
        cancellation: intent,
      };
      await manager.getRepository(BillingSubscriptionEntity).save(subscription);
      return subscription;
    });
    if (!claimed) return;
    let confirmed = !claimed.providerSubscriptionId;
    try {
      if (claimed.providerSubscriptionId) {
        const provider = await this.providers
          .get(claimed.provider)
          .getSubscription(claimed.providerSubscriptionId);
        confirmed = [
          SubscriptionStatus.Cancelled,
          SubscriptionStatus.Expired,
        ].includes(provider.subscriptionStatus);
        if (!confirmed) {
          await this.providers.get(claimed.provider).cancelSubscription({
            providerSubscriptionId: claimed.providerSubscriptionId,
            reason: cancellationIntent(claimed)?.reason ?? undefined,
          });
          confirmed = true;
        }
      }
    } catch {
      if (claimed.providerSubscriptionId) {
        try {
          const provider = await this.providers
            .get(claimed.provider)
            .getSubscription(claimed.providerSubscriptionId);
          confirmed = [
            SubscriptionStatus.Cancelled,
            SubscriptionStatus.Expired,
          ].includes(provider.subscriptionStatus);
        } catch {
          /* Durable intent is retried after a provider outage. */
        }
      }
    }
    await this.dataSource.transaction(async (manager) => {
      const subscription = await this.lockSubscription(manager, id);
      const intent = cancellationIntent(subscription);
      if (intent?.leaseToken !== token) return;
      delete intent.leaseToken;
      delete intent.leaseUntil;
      if (confirmed) {
        intent.state = 'scheduled';
        if (!subscription.metadata.refundRevocation) {
          subscription.status = SubscriptionStatus.Cancelled;
          subscription.nextBillingTime = null;
        }
      }
      subscription.metadata = {
        ...subscription.metadata,
        cancellation: intent,
      };
      await manager.getRepository(BillingSubscriptionEntity).save(subscription);
      if (confirmed)
        await this.upsertLicense(manager, subscription, LicenseStatus.Revoked);
    });
  }

  private async reconcileRevision(
    id: string,
    propagateError: boolean,
  ): Promise<void> {
    const pending = pendingPlanChange(await this.findSubscription(id));
    if (pending?.cancelRequestedAt && pending.state !== 'failed') {
      await this.cancelPlanChange(pending.checkoutId);
      return;
    }
    const token = randomUUID();
    const claimed = await this.dataSource.transaction(async (manager) => {
      const subscription = await this.lockSubscription(manager, id);
      const change = pendingPlanChange(subscription);
      if (
        !change ||
        ['effective', 'failed'].includes(change.state) ||
        !!change.cancelRequestedAt ||
        subscription.metadata.refundRevocation ||
        cancellationIntent(subscription) ||
        (change.leaseUntil && Date.parse(change.leaseUntil) > Date.now())
      )
        return null;
      change.leaseToken = token;
      change.leaseUntil = new Date(Date.now() + 60_000).toISOString();
      subscription.metadata = {
        ...subscription.metadata,
        pendingPlanChange: change,
      };
      await manager.getRepository(BillingSubscriptionEntity).save(subscription);
      return subscription;
    });
    if (!claimed?.providerSubscriptionId) return;
    const intent = pendingPlanChange(claimed)!;
    let failure: unknown;
    try {
      const checkout = await this.checkoutSessions.findOne({
        where: { id: intent.checkoutId },
        relations: { planPrice: true },
      });
      if (!checkout)
        throw new NotFoundException('Plan revision checkout not found');
      let provider = await this.providers
        .get(claimed.provider)
        .getSubscription(claimed.providerSubscriptionId);
      if (
        provider.planId !== intent.targetProviderPlanId &&
        !checkout.providerCheckoutUrl &&
        Date.parse(intent.effectiveAt) > Date.now()
      ) {
        const revision = await this.providers
          .get(claimed.provider)
          .reviseSubscription({
            providerSubscriptionId: claimed.providerSubscriptionId,
            providerPlanId: intent.targetProviderPlanId,
            requestId: checkout.id,
            returnUrl: checkout.successUrl,
            cancelUrl: checkout.cancelUrl,
          });
        if (!revision.approvalUrl)
          throw new BadGatewayException(
            'Provider revision approval URL is unavailable',
          );
        await this.checkoutSessions.update(checkout.id, {
          providerCheckoutUrl: revision.approvalUrl,
          status: BillingCheckoutSessionStatus.Pending,
        });
        provider = await this.providers
          .get(claimed.provider)
          .getSubscription(claimed.providerSubscriptionId);
      }
      await this.reconcileProration(
        claimed,
        intent,
        checkout,
        provider,
        token,
        propagateError,
      );
      await this.dataSource.transaction(async (manager) => {
        const subscription = await this.lockSubscription(manager, id);
        const change = pendingPlanChange(subscription);
        if (change?.leaseToken !== token) return;
        delete change.leaseToken;
        delete change.leaseUntil;
        if (
          cancellationIntent(subscription) ||
          subscription.metadata.refundRevocation
        )
          change.state = 'failed';
        else {
          if (change.state === 'preparing') change.state = 'awaiting_approval';
          await applyConfirmedPlanChange(manager, subscription, provider);
          if (
            provider.planId !== change.targetProviderPlanId &&
            Date.parse(change.requestedEffectiveAt ?? change.effectiveAt) <=
              Date.now()
          )
            change.state = 'failed';
        }
        subscription.metadata = {
          ...subscription.metadata,
          pendingPlanChange: change,
        };
        await manager
          .getRepository(BillingSubscriptionEntity)
          .save(subscription);
        if (change.state === 'failed')
          await manager
            .getRepository(BillingCheckoutSessionEntity)
            .update(change.checkoutId, {
              status: BillingCheckoutSessionStatus.Cancelled,
              metadata: {
                ...checkout.metadata,
                planChangeState: 'failed',
                planChangeEffectiveAt: change.effectiveAt,
              },
            });
        if (change.state === 'scheduled' || change.state === 'effective') {
          if (change.state === 'effective') {
            if (change.quote?.kind !== 'upgrade' || !change.captureId) {
              subscription.currentPeriodStart = this.dateOrNull(
                provider.lastPaymentAt,
              );
              subscription.nextBillingTime = this.dateOrNull(
                provider.nextBillingAt,
              );
              subscription.currentPeriodEnd = subscription.nextBillingTime;
            }
            await manager
              .getRepository(BillingSubscriptionEntity)
              .save(subscription);
            await this.upsertLicense(
              manager,
              subscription,
              LicenseStatus.Active,
            );
          }
          const latest = await manager
            .getRepository(BillingCheckoutSessionEntity)
            .findOne({ where: { id: change.checkoutId } });
          if (!latest?.providerCheckoutUrl)
            await manager
              .getRepository(BillingCheckoutSessionEntity)
              .update(change.checkoutId, {
                providerCheckoutUrl: checkout.successUrl,
              });
        }
      });
    } catch (error) {
      failure = error;
    }
    if (failure) {
      await this.dataSource.transaction(async (manager) => {
        const subscription = await this.lockSubscription(manager, id);
        const change = pendingPlanChange(subscription);
        if (change?.leaseToken === token) {
          delete change.leaseToken;
          delete change.leaseUntil;
          subscription.metadata = {
            ...subscription.metadata,
            pendingPlanChange: change,
          };
          await manager
            .getRepository(BillingSubscriptionEntity)
            .save(subscription);
        }
      });
      if (propagateError)
        throw new BadGatewayException(
          'Provider revision is pending; retry the same idempotency key',
        );
    }
  }

  private async reconcileProration(
    claimed: BillingSubscriptionEntity,
    intent: PendingPlanChange,
    checkout: BillingCheckoutSessionEntity,
    provider: import('../providers/billing-provider.types').ProviderSubscription,
    token: string,
    refreshQuote: boolean,
  ): Promise<void> {
    if (
      intent.quote?.kind !== 'upgrade' ||
      intent.proration?.refundedAt ||
      provider.subscriptionStatus !== SubscriptionStatus.Active ||
      provider.planId !== intent.targetProviderPlanId
    )
      return;
    let quote = intent.quote;
    const persist = async (patch: Partial<PendingPlanChange>) => {
      await this.dataSource.transaction(async (manager) => {
        const subscription = await this.lockSubscription(manager, claimed.id);
        const change = pendingPlanChange(subscription);
        if (
          change?.leaseToken !== token ||
          cancellationIntent(subscription) ||
          subscription.metadata.refundRevocation
        )
          throw new ConflictException('Plan change no longer authorized');
        Object.assign(change, patch);
        Object.assign(intent, patch);
        subscription.metadata = {
          ...subscription.metadata,
          pendingPlanChange: change,
        };
        await manager
          .getRepository(BillingSubscriptionEntity)
          .save(subscription);
      });
    };
    if (!intent.approvedAt)
      await persist({ approvedAt: new Date().toISOString() });
    if (quote.amountDueNow === '0.00' || intent.captureId) return;
    let order:
      import('../providers/billing-provider.types').ProviderOrder | undefined;
    if (intent.paymentOrderId) {
      try {
        order = await this.providers
          .get(claimed.provider)
          .getOrder(intent.paymentOrderId);
      } catch (error) {
        // A missing order is replaceable only before any capture and after quote expiry.
        if (
          !(error instanceof NotFoundException) ||
          !refreshQuote ||
          intent.captureAttemptedAt ||
          !intent.paymentQuoteExpiresAt ||
          Date.now() < Date.parse(intent.paymentQuoteExpiresAt) ||
          Date.now() >= Date.parse(quote.nextBillingAt) - 60_000
        )
          throw error;
        order = { id: intent.paymentOrderId, status: 'cancelled', units: [] };
      }
      // A timed-out capture always reconciles its original order, even after quote expiry.
      if (
        refreshQuote &&
        order.status !== 'completed' &&
        !intent.captureAttemptedAt &&
        Date.now() >=
          Date.parse(
            intent.paymentQuoteExpiresAt ??
              intent.orderCreateAttemptedAt ??
              intent.requestedAt,
          ) &&
        Date.now() < Date.parse(quote.nextBillingAt) - 60_000
      ) {
        await persist({
          paymentOrderGeneration: (intent.paymentOrderGeneration ?? 0) + 1,
          paymentOrderId: undefined,
          paymentApprovalUrl: undefined,
          orderCreateAttemptedAt: undefined,
          paymentQuoteExpiresAt: undefined,
        });
        order = undefined;
      }
    }
    if (!order) {
      // Never recreate an uncertain charge after this provider's idempotency window.
      if (
        intent.orderCreateAttemptedAt &&
        Date.now() - Date.parse(intent.orderCreateAttemptedAt) >
          this.providers.get(claimed.provider).orderIdempotencyWindowMs
      )
        throw new ConflictException(
          'Provider order creation requires reconciliation',
        );
      if (Date.now() >= Date.parse(quote.nextBillingAt) - 60_000) return;
      if (!intent.orderCreateAttemptedAt) {
        if (!checkout.planPrice)
          throw new BadGatewayException('Plan revision price is unavailable');
        const currentPrice =
          claimed.planPrice ??
          this.planResolver.activePrice(
            this.planResolver.contractVersion(claimed),
            claimed.planPriceCode ?? undefined,
          );
        const updatedQuote = calculatePlanChangeQuote(
          claimed,
          currentPrice,
          checkout.planPrice,
        );
        if (cents(updatedQuote.amountDueNow) > cents(quote.amountDueNow))
          throw new ConflictException('Proration exceeds the accepted quote');
        quote = updatedQuote;
        // Freeze the amount before provider I/O so uncertain retries cannot change it.
        await persist({
          quote,
          orderCreateAttemptedAt: new Date().toISOString(),
          paymentQuoteExpiresAt: new Date(
            Math.min(
              Date.now() + 15 * 60_000,
              Date.parse(quote.nextBillingAt) - 60_000,
            ),
          ).toISOString(),
        });
      }
      if (quote.amountDueNow === '0.00') return;
      order = await this.providers.get(claimed.provider).createOrder({
        requestId: createHash('sha256')
          .update(
            checkout.id + ':order:' + (intent.paymentOrderGeneration ?? 0),
          )
          .digest('hex')
          .slice(0, 32),
        checkoutId: checkout.id,
        amount: quote.amountDueNow,
        currency: quote.currency,
        returnUrl: checkout.successUrl,
        cancelUrl: checkout.cancelUrl,
      });
      if (!order.id) throw new BadGatewayException('Provider order id missing');
      await persist({
        paymentOrderId: order.id,
        paymentApprovalUrl: order.approvalUrl,
      });
    }
    if (order.id !== intent.paymentOrderId)
      throw new BadGatewayException('Provider order mismatch');
    const unit = order.units[0];
    if (
      order.units.length !== 1 ||
      unit?.checkoutId !== checkout.id ||
      unit.currency !== quote.currency ||
      typeof unit.amount !== 'string' ||
      cents(unit.amount) !== cents(quote.amountDueNow)
    )
      throw new BadGatewayException('Provider proration amount mismatch');
    if (order.status === 'approved') {
      if (
        !intent.captureAttemptedAt &&
        Date.now() >=
          Date.parse(
            intent.paymentQuoteExpiresAt ??
              intent.orderCreateAttemptedAt ??
              intent.requestedAt,
          )
      )
        return;
      if (Date.now() >= Date.parse(quote.nextBillingAt) - 60_000) return;
      if (
        intent.captureAttemptedAt &&
        Date.now() - Date.parse(intent.captureAttemptedAt) >
          this.providers.get(claimed.provider).orderIdempotencyWindowMs
      )
        throw new ConflictException('Provider capture requires reconciliation');
      if (!intent.captureAttemptedAt)
        await persist({ captureAttemptedAt: new Date().toISOString() });
      // Distinct UUID for capture, stable across retries and process restarts.
      order = await this.providers.get(claimed.provider).captureOrder(
        intent.paymentOrderId,
        createHash('sha256')
          .update(checkout.id + ':capture:' + intent.paymentOrderId)
          .digest('hex')
          .slice(0, 32),
      );
    }
    if (order.status !== 'completed') return;
    if (
      order.id !== intent.paymentOrderId ||
      order.units.length !== 1 ||
      order.units[0]?.checkoutId !== checkout.id ||
      order.units[0].currency !== quote.currency ||
      typeof order.units[0].amount !== 'string' ||
      cents(order.units[0].amount) !== cents(quote.amountDueNow)
    )
      throw new BadGatewayException('Provider capture order mismatch');
    const captures = order.units[0]?.captures;
    const capture = captures?.[0];
    if (
      captures?.length !== 1 ||
      capture?.status !== 'completed' ||
      !capture.id ||
      capture.currency !== quote.currency ||
      typeof capture.amount !== 'string' ||
      cents(capture.amount) !== cents(quote.amountDueNow)
    )
      throw new BadGatewayException('Provider capture confirmation mismatch');
    await this.dataSource.transaction(async (manager) => {
      const subscription = await this.lockSubscription(manager, claimed.id);
      const change = pendingPlanChange(subscription);
      if (change?.leaseToken !== token)
        throw new ConflictException('Plan change lease lost');
      const payments = manager.getRepository(BillingPaymentEntity);
      const existing = await payments.findOne({
        where: {
          provider: subscription.provider,
          providerCaptureId: String(capture.id),
        },
      });
      if (existing && existing.status !== PaymentStatus.Paid)
        throw new ConflictException('Proration payment was reversed');
      if (!existing)
        await payments.save(
          payments.create({
            organizationId: subscription.organizationId,
            subscriptionId: subscription.id,
            provider: subscription.provider,
            providerPaymentId: change.paymentOrderId,
            providerCaptureId: String(capture.id),
            amount: quote.amountDueNow,
            currency: quote.currency as BillingPaymentEntity['currency'],
            status: PaymentStatus.Paid,
            paidAt: this.dateOrNull(capture.paidAt) ?? new Date(),
            periodStart: new Date(quote.effectiveAt),
            periodEnd: new Date(quote.nextBillingAt),
            rawEventId: null,
            metadata: {
              operation: 'plan_change_proration',
              checkoutId: checkout.id,
              previousPlan: {
                planId: subscription.planId,
                planPriceId: subscription.planPriceId,
                providerPriceId: subscription.providerPriceId,
                planCode: subscription.planCode,
                planPriceCode: subscription.planPriceCode,
                legalAcceptanceId: subscription.legalAcceptanceId,
                acceptedAt: subscription.acceptedAt,
                legalSnapshotHash: subscription.legalSnapshotHash,
                legalEvidence: subscription.metadata.legalEvidence,
              },
            },
          }),
        );
      change.captureId = String(capture.id);
      change.capturedAt = (
        this.dateOrNull(capture.paidAt) ?? new Date()
      ).toISOString();
      subscription.metadata = {
        ...subscription.metadata,
        pendingPlanChange: change,
      };
      await manager.getRepository(BillingSubscriptionEntity).save(subscription);
      await this.audit.record({
        manager,
        organizationId: subscription.organizationId,
        action: 'billing.payment.created',
        resourceType: 'billing_subscription',
        resourceId: subscription.id,
        metadata: {
          checkoutSessionId: checkout.id,
          providerCaptureId: change.captureId,
          amount: quote.amountDueNow,
          currency: quote.currency,
          operation: 'plan_change_proration',
        },
      });
    });
  }

  async verifyCheckoutSession(
    checkoutId: string,
    actorUserId?: string,
  ): Promise<VerifyCheckoutSessionResponseDto> {
    const checkoutSession = await this.checkoutSessions.findOne({
      where: { id: checkoutId },
    });
    if (!checkoutSession) {
      throw new NotFoundException('Billing checkout session not found');
    }

    const subscriptionId = this.stringOrNull(
      checkoutSession.metadata?.subscriptionId,
    );
    if (
      subscriptionId &&
      checkoutSession.metadata.operation === 'plan_change' &&
      checkoutSession.metadata.planChangeState === 'failed'
    ) {
      const subscription = await this.findSubscription(subscriptionId);
      return {
        checkoutId,
        subscriptionId,
        provider: subscription.provider,
        providerSubscriptionId: subscription.providerSubscriptionId,
        providerStatus: null,
        checkoutStatus: BillingCheckoutSessionStatus.Cancelled,
        subscriptionStatus: subscription.status,
        licenseStatus: null,
        verifiedAt: new Date(),
        planChange: {
          state: 'failed',
          effectiveAt: String(checkoutSession.metadata.planChangeEffectiveAt),
          cancellationRequested: true,
          action: 'none',
          checkoutUrl: null,
        },
      };
    }
    if (subscriptionId && checkoutSession.metadata.operation === 'plan_change')
      await this.reconcileRevision(subscriptionId, true);
    const subscription = subscriptionId
      ? await this.findSubscription(subscriptionId)
      : null;

    if (!subscription) {
      throw new NotFoundException('Billing subscription not found');
    }
    const cancellation = pendingPlanChange(subscription);
    if (
      checkoutSession.metadata.operation === 'plan_change' &&
      cancellation?.checkoutId === checkoutId &&
      cancellation.cancelRequestedAt
    ) {
      return {
        checkoutId,
        subscriptionId: subscription.id,
        provider: subscription.provider,
        providerSubscriptionId: subscription.providerSubscriptionId,
        providerStatus: null,
        checkoutStatus:
          cancellation.state === 'failed'
            ? BillingCheckoutSessionStatus.Cancelled
            : BillingCheckoutSessionStatus.Pending,
        subscriptionStatus: subscription.status,
        licenseStatus: null,
        verifiedAt: new Date(),
        planChange: this.checkout.planChangeResponse(
          subscription.provider,
          cancellation,
          checkoutSession.providerCheckoutUrl,
        ),
      };
    }
    if (checkoutSession.provider !== subscription.provider)
      throw new ConflictException(
        'Checkout provider differs from subscription',
      );
    if (!subscription.providerSubscriptionId) {
      throw new BadRequestException('Provider subscription id is missing');
    }

    const providerSubscription = await this.providers
      .get(subscription.provider)
      .getSubscription(subscription.providerSubscriptionId);
    const providerStatus = providerSubscription.status ?? null;
    let newStatus = providerSubscription.subscriptionStatus;
    let licenseStatus = this.mapLicenseStatus(newStatus);
    const verifiedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      const lockedSubscription = await manager
        .getRepository(BillingSubscriptionEntity)
        .findOne({
          where: { id: subscription.id },
          lock: { mode: 'pessimistic_write' },
        });
      if (!lockedSubscription) {
        throw new NotFoundException('Billing subscription not found');
      }
      const { plan, planPrice, providerPrice } = subscription;
      Object.assign(subscription, lockedSubscription, {
        plan,
        planPrice,
        providerPrice,
      });
      const previousStatus = subscription.status;
      // A refund marker remains terminal even if PayPal reports a later active period.
      const refundRevoked = Boolean(subscription.metadata.refundRevocation);
      if (refundRevoked) {
        newStatus = SubscriptionStatus.Cancelled;
        licenseStatus = LicenseStatus.Revoked;
        subscription.cancelAtPeriodEnd = false;
      }
      subscription.status = newStatus;
      if (!refundRevoked) {
        subscription.nextBillingTime = this.dateOrNull(
          providerSubscription.nextBillingAt,
        );
        subscription.currentPeriodStart =
          this.dateOrNull(providerSubscription.periodStart) ??
          subscription.currentPeriodStart;
        subscription.currentPeriodEnd =
          this.dateOrNull(providerSubscription.periodEnd) ??
          subscription.nextBillingTime ??
          (newStatus === SubscriptionStatus.Cancelled &&
          subscription.cancelAtPeriodEnd
            ? subscription.currentPeriodEnd
            : null);
        subscription.graceUntil =
          newStatus === SubscriptionStatus.Active
            ? null
            : subscription.graceUntil;
      } else {
        subscription.nextBillingTime = null;
      }
      subscription.metadata = {
        ...subscription.metadata,
        providerStatus,
        providerPlanId: providerSubscription.planId ?? null,
        manuallyVerifiedAt: verifiedAt.toISOString(),
      };

      await applyConfirmedPlanChange(
        manager,
        subscription,
        providerSubscription,
        verifiedAt,
      );
      await manager.getRepository(BillingSubscriptionEntity).save(subscription);

      const revision = pendingPlanChange(subscription);
      checkoutSession.status =
        checkoutSession.metadata.operation === 'plan_change' &&
        revision?.checkoutId === checkoutSession.id
          ? ['scheduled', 'effective'].includes(revision.state)
            ? BillingCheckoutSessionStatus.Approved
            : BillingCheckoutSessionStatus.Pending
          : this.mapCheckoutStatus(newStatus);
      await manager
        .getRepository(BillingCheckoutSessionEntity)
        .update(checkoutSession.id, { status: checkoutSession.status });

      if (previousStatus !== newStatus) {
        await this.audit.record({
          manager,
          organizationId: subscription.organizationId,
          action: 'billing.subscription.status_changed',
          resourceType: 'billing_subscription',
          resourceId: subscription.id,
          provider: subscription.provider,
          legalReference: this.toLegalReference(subscription),
          metadata: {
            checkoutSessionId: checkoutSession.id,
            subscriptionId: subscription.id,
            previousStatus,
            newStatus,
            providerSubscriptionId: subscription.providerSubscriptionId,
            providerStatus,
          },
        });
      }

      if (licenseStatus) {
        await this.upsertLicense(manager, subscription, licenseStatus);
      }

      await this.audit.record({
        manager,
        organizationId: subscription.organizationId,
        actorUserId: actorUserId ?? checkoutSession.userId,
        action: 'billing.checkout.manual_verified',
        resourceType: 'billing_checkout_session',
        resourceId: checkoutSession.id,
        provider: subscription.provider,
        legalReference: this.toLegalReference(subscription),
        metadata: {
          checkoutSessionId: checkoutSession.id,
          subscriptionId: subscription.id,
          newStatus,
          providerSubscriptionId: subscription.providerSubscriptionId,
          providerStatus,
        },
      });
    });

    return {
      checkoutId: checkoutSession.id,
      ...(checkoutSession.metadata.operation === 'plan_change' &&
      pendingPlanChange(subscription)?.checkoutId === checkoutSession.id
        ? {
            planChange: this.checkout.planChangeResponse(
              checkoutSession.provider,
              pendingPlanChange(subscription)!,
              checkoutSession.providerCheckoutUrl,
            ),
            checkoutUrl: this.checkout.planChangeResponse(
              checkoutSession.provider,
              pendingPlanChange(subscription)!,
              checkoutSession.providerCheckoutUrl,
            ).checkoutUrl,
          }
        : {}),
      subscriptionId: subscription.id,
      provider: checkoutSession.provider,
      providerSubscriptionId: subscription.providerSubscriptionId,
      providerStatus,
      checkoutStatus: checkoutSession.status,
      subscriptionStatus: subscription.status,
      licenseStatus,
      verifiedAt,
    };
  }

  private async upsertLicense(
    manager: EntityManager,
    subscription: BillingSubscriptionEntity,
    status: LicenseStatus,
  ): Promise<void> {
    const product = await manager
      .getRepository(BillingProductEntity)
      .findOne({ where: { code: subscription.productCode } });
    if (!product) return;

    const licenses = manager.getRepository(BillingLicenseEntity);
    const existing = await licenses.findOne({
      where: { subscriptionId: subscription.id },
    });
    const previousStatus = existing?.status ?? null;
    const previousPlanCode = existing?.planCode ?? null;
    const calculation = this.licenseCalculator.calculate({
      license: existing,
      product,
      subscription,
      status,
    });
    const license =
      existing ??
      licenses.create({
        organizationId: calculation.organizationId,
        productId: calculation.productId,
        productCode: calculation.productCode,
        subscriptionId: calculation.subscriptionId,
        planCode: calculation.planCode,
        licenseKeyHash: calculation.licenseKeyHash,
      });

    license.planCode = calculation.planCode;
    license.status = calculation.status;
    license.seatsLimit = calculation.seatsLimit;
    license.usageLimit = calculation.usageLimit;
    license.featuresJson = calculation.featuresJson;
    license.validUntil =
      subscription.metadata.refundRevocation && existing
        ? existing.validUntil
        : calculation.validUntil;
    const saved = await licenses.save(license);

    if (
      previousStatus !== calculation.status ||
      previousPlanCode !== calculation.planCode
    ) {
      await this.audit.record({
        manager,
        organizationId: subscription.organizationId,
        action: 'billing.license.status_changed',
        resourceType: 'billing_license',
        resourceId: saved.id,
        provider: subscription.provider,
        legalReference: this.toLegalReference(subscription),
        metadata: {
          subscriptionId: subscription.id,
          licenseId: saved.id,
          previousStatus,
          newStatus: calculation.status,
          providerSubscriptionId: subscription.providerSubscriptionId,
        },
      });
    }
  }

  private async findSubscription(
    subscriptionId: string,
  ): Promise<BillingSubscriptionEntity> {
    const subscription = await this.subscriptions.findOne({
      where: { id: subscriptionId },
      relations: {
        plan: {
          versions: {
            prices: { providerPrices: true },
            entitlements: { feature: true },
          },
        },
        planPrice: true,
        providerPrice: true,
      },
    });
    if (!subscription) {
      throw new NotFoundException('Billing subscription not found');
    }
    return subscription;
  }

  private async findTargetPlan(
    subscription: BillingSubscriptionEntity,
    targetPlanCode: string,
    targetPlanPriceCode: string,
  ): Promise<BillingPlanEntity> {
    const targetPlan = await this.plans.findOne({
      where: {
        productId: subscription.plan.productId,
        code: targetPlanCode,
        status: BillingPlanStatus.Active,
      },
      relations: {
        versions: {
          prices: { providerPrices: true },
          entitlements: { feature: true },
        },
      },
    });

    if (!targetPlan)
      throw new NotFoundException('Target billing plan not found');
    const currentPrice =
      subscription.planPrice ??
      this.planResolver.activePrice(
        this.planResolver.contractVersion(subscription),
        subscription.planPriceCode ?? undefined,
      );
    const target = this.planResolver.resolve(
      targetPlan,
      subscription.provider,
      targetPlanPriceCode,
    );
    if (target.price.id === currentPrice.id) {
      throw new BadRequestException('Target plan price must be different');
    }
    if (target.price.currency !== currentPrice.currency) {
      throw new BadRequestException('Target plan currency must match');
    }
    if (!target.providerPrice.providerPriceId) {
      throw new BadRequestException('Target provider plan id is required');
    }

    return targetPlan;
  }

  private async toResponse(subscription: BillingSubscriptionEntity) {
    const reloaded = subscription.plan
      ? subscription
      : await this.findSubscription(subscription.id);
    const resolution = await this.entitlements.resolveForSubscription(
      reloaded.id,
    );
    const response = SubscriptionManagementMapper.toResponse(
      reloaded,
      resolution,
    );
    if (response.pendingPlanChange?.checkoutUrl)
      response.pendingPlanChange.checkoutUrl = this.providers
        .get(reloaded.provider)
        .validateApprovalUrl(response.pendingPlanChange.checkoutUrl);
    return response;
  }

  private mapLicenseStatus(status: SubscriptionStatus): LicenseStatus | null {
    switch (status) {
      case SubscriptionStatus.Active:
        return LicenseStatus.Active;
      case SubscriptionStatus.Suspended:
        return LicenseStatus.Suspended;
      case SubscriptionStatus.Cancelled:
      case SubscriptionStatus.Expired:
        return LicenseStatus.Revoked;
      default:
        return null;
    }
  }

  private mapCheckoutStatus(
    status: SubscriptionStatus,
  ): BillingCheckoutSessionStatus {
    switch (status) {
      case SubscriptionStatus.Active:
        return BillingCheckoutSessionStatus.Approved;
      case SubscriptionStatus.Cancelled:
      case SubscriptionStatus.Expired:
        return BillingCheckoutSessionStatus.Cancelled;
      default:
        return BillingCheckoutSessionStatus.Pending;
    }
  }

  private dateOrNull(value: unknown): Date | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }

  private toLegalReference(subscription: BillingSubscriptionEntity) {
    if (
      !subscription.legalAcceptanceId ||
      !subscription.acceptedAt ||
      !subscription.legalSnapshotHash
    )
      return undefined;
    return {
      legalAcceptanceId: subscription.legalAcceptanceId,
      evidence: Array.isArray(subscription.metadata?.legalEvidence)
        ? subscription.metadata.legalEvidence
        : undefined,
      acceptedAt: subscription.acceptedAt,
      legalSnapshotHash: subscription.legalSnapshotHash,
    };
  }
}
