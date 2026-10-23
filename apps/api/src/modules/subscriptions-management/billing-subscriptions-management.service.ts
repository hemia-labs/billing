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
  BillingLicenseEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import {
  BillingCheckoutSessionStatus,
  BillingPlanStatus,
  BillingProvider,
  LicenseStatus,
  SubscriptionStatus,
} from '../billing-shared';
import { BillingLicenseCalculatorService } from '../licenses';
import { PaypalClientService } from '../paypal';
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
    private readonly paypal: PaypalClientService,
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

  async cancelSubscription(subscriptionId: string, dto: CancelSubscriptionDto) {
    const source = await this.findSubscription(subscriptionId);
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
      subscription.cancelAtPeriodEnd = true;
      subscription.metadata = {
        ...subscription.metadata,
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
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          actor.issuer,
          actor.clientId,
          dto.actorUserId,
          dto.targetPlanCode,
          dto.targetPlanPriceCode,
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
      if (
        !receipt.providerCheckoutUrl ||
        !['scheduled', 'effective'].includes(String(state))
      )
        throw new ConflictException(
          'Historical plan change cannot be restarted; create a new request',
        );
      return {
        subscription: await this.toResponse(subscription),
        checkoutId: receipt.id,
        newSubscriptionId: subscription.id,
        checkoutUrl: receipt.providerCheckoutUrl,
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
        subscription.provider !== BillingProvider.Paypal ||
        !subscription.providerSubscriptionId ||
        subscription.status !== SubscriptionStatus.Active ||
        subscription.cancelAtPeriodEnd ||
        subscription.metadata.refundRevocation
      )
        throw new BadRequestException(
          'An active renewing PayPal subscription is required',
        );
      if (change && !['effective', 'failed'].includes(change.state))
        throw new ConflictException('Another plan change is pending');
      const end = subscription.currentPeriodEnd ?? subscription.nextBillingTime;
      if (!end || end.getTime() <= Date.now())
        throw new BadRequestException(
          'A confirmed future billing boundary is required',
        );
      const targetPlan = await this.findTargetPlan(
        subscription,
        dto.targetPlanCode,
        dto.targetPlanPriceCode,
      );
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
        },
      });
      await this.dataSource.transaction(async (manager) => {
        subscription = await this.lockSubscription(manager, subscriptionId);
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
        const intent: PendingPlanChange = {
          idempotencyKey: dto.idempotencyKey,
          requestHash,
          state: 'preparing',
          targetPlanCode: dto.targetPlanCode,
          targetPlanPriceCode: dto.targetPlanPriceCode,
          targetProviderPlanId: String(checkout.metadata.paypalPlanId),
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
    if (!checkout?.providerCheckoutUrl)
      throw new BadGatewayException(
        'Plan change confirmation is pending; retry the same idempotency key',
      );
    return {
      subscription: await this.toResponse(subscription),
      checkoutId: checkout.id,
      newSubscriptionId: subscription.id,
      checkoutUrl: checkout.providerCheckoutUrl,
      targetPlanCode: change.targetPlanCode,
      effectiveAt: change.effectiveAt,
      state:
        change.state === 'effective'
          ? 'effective'
          : change.state === 'scheduled'
            ? 'scheduled'
            : 'awaiting_approval',
    };
  }

  // Intents survive API timeouts and process restarts; remote I/O never holds a DB transaction.
  @Cron('*/1 * * * *', { name: 'subscription-management-recovery' })
  async recoverManagement(): Promise<void> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM subscriptions WHERE deleted_at IS NULL AND (metadata #>> '{cancellation,state}'='pending' OR metadata #>> '{pendingPlanChange,state}' IN ('preparing','awaiting_approval','scheduled')) ORDER BY updated_at LIMIT 25`,
    );
    for (const row of rows) {
      try {
        const subscription = await this.findSubscription(row.id);
        if (cancellationIntent(subscription)?.state === 'pending')
          await this.reconcileCancellation(row.id);
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
        const provider = await this.paypal.getSubscription(
          claimed.providerSubscriptionId,
        );
        confirmed = ['CANCELLED', 'EXPIRED'].includes(provider.status ?? '');
        if (!confirmed) {
          await this.paypal.cancelSubscription({
            providerSubscriptionId: claimed.providerSubscriptionId,
            reason: cancellationIntent(claimed)?.reason ?? undefined,
          });
          confirmed = true;
        }
      }
    } catch {
      if (claimed.providerSubscriptionId) {
        try {
          const provider = await this.paypal.getSubscription(
            claimed.providerSubscriptionId,
          );
          confirmed = ['CANCELLED', 'EXPIRED'].includes(provider.status ?? '');
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
    const token = randomUUID();
    const claimed = await this.dataSource.transaction(async (manager) => {
      const subscription = await this.lockSubscription(manager, id);
      const change = pendingPlanChange(subscription);
      if (
        !change ||
        ['effective', 'failed'].includes(change.state) ||
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
      });
      if (!checkout)
        throw new NotFoundException('Plan revision checkout not found');
      let provider = await this.paypal.getSubscription(
        claimed.providerSubscriptionId,
      );
      if (
        provider.planId !== intent.targetProviderPlanId &&
        !checkout.providerCheckoutUrl &&
        Date.parse(intent.effectiveAt) > Date.now()
      ) {
        const revision = await this.paypal.reviseSubscription({
          providerSubscriptionId: claimed.providerSubscriptionId,
          providerPlanId: intent.targetProviderPlanId,
          requestId: checkout.id,
          returnUrl: checkout.successUrl,
          cancelUrl: checkout.cancelUrl,
        });
        if (!revision.approvalUrl)
          throw new BadGatewayException(
            'PayPal revision approval URL is unavailable',
          );
        await this.checkoutSessions.update(checkout.id, {
          providerCheckoutUrl: revision.approvalUrl,
          status: BillingCheckoutSessionStatus.Pending,
        });
        provider = await this.paypal.getSubscription(
          claimed.providerSubscriptionId,
        );
      }
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
            !checkout.providerCheckoutUrl &&
            Date.parse(change.effectiveAt) <= Date.now()
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
        if (change.state === 'scheduled' || change.state === 'effective') {
          const details =
            provider.billingInfo ??
            (provider.raw.billing_info as Record<string, unknown> | undefined);
          if (change.state === 'effective') {
            subscription.currentPeriodStart = this.dateOrNull(
              (details?.last_payment as { time?: string } | undefined)?.time,
            );
            subscription.nextBillingTime = this.dateOrNull(
              details?.next_billing_time,
            );
            subscription.currentPeriodEnd = subscription.nextBillingTime;
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
          'PayPal revision is pending; retry the same idempotency key',
        );
    }
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
    const subscription = subscriptionId
      ? await this.findSubscription(subscriptionId)
      : null;

    if (!subscription) {
      throw new NotFoundException('Billing subscription not found');
    }
    if (!subscription.providerSubscriptionId) {
      throw new BadRequestException('Provider subscription id is missing');
    }

    const paypalSubscription = await this.paypal.getSubscription(
      subscription.providerSubscriptionId,
    );
    const providerStatus = paypalSubscription.status ?? null;
    const billingInfo = paypalSubscription.billingInfo;
    let newStatus = this.mapPaypalSubscriptionStatus(providerStatus);
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
          billingInfo?.next_billing_time,
        );
        subscription.currentPeriodStart = this.dateOrNull(
          this.getNested(billingInfo, 'cycle_executions', 0, 'start_time'),
        );
        subscription.currentPeriodEnd =
          this.dateOrNull(
            this.getNested(billingInfo, 'cycle_executions', 0, 'end_time'),
          ) ??
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
        paypalStatus: providerStatus,
        paypalProviderPlanId: paypalSubscription.planId ?? null,
        manuallyVerifiedAt: verifiedAt.toISOString(),
      };

      await applyConfirmedPlanChange(
        manager,
        subscription,
        paypalSubscription,
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

    license.status = calculation.status;
    license.seatsLimit = calculation.seatsLimit;
    license.usageLimit = calculation.usageLimit;
    license.featuresJson = calculation.featuresJson;
    license.validUntil =
      subscription.metadata.refundRevocation && existing
        ? existing.validUntil
        : calculation.validUntil;
    const saved = await licenses.save(license);

    if (previousStatus !== calculation.status) {
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
      throw new BadRequestException('Target PayPal plan id is required');
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
    return SubscriptionManagementMapper.toResponse(reloaded, resolution);
  }

  private mapPaypalSubscriptionStatus(
    paypalStatus: string | null,
  ): SubscriptionStatus {
    switch (paypalStatus) {
      case 'ACTIVE':
        return SubscriptionStatus.Active;
      case 'SUSPENDED':
        return SubscriptionStatus.Suspended;
      case 'CANCELLED':
        return SubscriptionStatus.Cancelled;
      case 'EXPIRED':
        return SubscriptionStatus.Expired;
      case 'APPROVAL_PENDING':
      case 'APPROVED':
        return SubscriptionStatus.Pending;
      default:
        return SubscriptionStatus.Pending;
    }
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

  private getNested(value: unknown, ...path: Array<string | number>): unknown {
    return path.reduce<unknown>((current, key) => {
      if (typeof key === 'number') {
        return Array.isArray(current) ? current[key] : undefined;
      }

      return this.asRecord(current)?.[key];
    }, value);
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
