import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  BillingCheckoutSessionEntity,
  BillingCustomerEntity,
  BillingPlanEntity,
  BillingProductEntity,
  BillingSubscriptionEntity,
} from '../billing-shared';
import {
  BillingCheckoutSessionStatus,
  BillingCustomerStatus,
  BillingPlanStatus,
  BillingProductStatus,
  BillingProvider,
  SubscriptionStatus,
} from '../billing-shared';
import { BillingPlanCatalogResolver } from '../catalog';
import { PaypalClientService } from '../paypal';
import { HemiaLegalClientService } from './clients';
import {
  CheckoutSessionResponseDto,
  CheckoutSessionStatusResponseDto,
  CreateCheckoutSessionDto,
} from './dtos';
import { BillingAuditService } from '../audit';
import { BillingServicePolicyService } from '../../common/services/billing-service-policy.service';
import type { BillingServiceActor } from '../../common/types/billing-service-authorization.type';
import type { PaypalSubscriptionResult } from '../paypal/types';
import { CheckoutInProgressException } from './errors/checkout-in-progress.exception';

const PAYPAL_IDEMPOTENCY_WINDOW_MS = 72 * 60 * 60 * 1000;
// Covers the PayPal OAuth and subscription request timeouts with margin.
const CHECKOUT_ATTEMPT_LEASE_MS = 60_000;

type CheckoutReservation = {
  checkout: BillingCheckoutSessionEntity;
  subscription: BillingSubscriptionEntity;
  attemptId: string;
};

@Injectable()
export class BillingCheckoutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hemiaLegal: HemiaLegalClientService,
    private readonly paypal: PaypalClientService,
    private readonly audit: BillingAuditService,
    @InjectRepository(BillingCheckoutSessionEntity)
    private readonly checkoutSessions: Repository<BillingCheckoutSessionEntity>,
    @InjectRepository(BillingSubscriptionEntity)
    private readonly subscriptions: Repository<BillingSubscriptionEntity>,
    private readonly planResolver: BillingPlanCatalogResolver,
    private readonly servicePolicy: BillingServicePolicyService,
  ) {}

  async createCheckoutSession(
    dto: CreateCheckoutSessionDto,
    actor: BillingServiceActor,
  ): Promise<CheckoutSessionResponseDto> {
    await this.servicePolicy.assertContext(
      actor,
      dto.productCode,
      dto.organizationId,
    );
    await this.servicePolicy.assertReturnUrls(
      actor,
      dto.successUrl,
      dto.cancelUrl,
    );
    if (
      typeof dto.idempotencyKey !== 'string' ||
      !/^\S{1,120}$/.test(dto.idempotencyKey)
    ) {
      throw new BadRequestException('A valid idempotencyKey is required');
    }
    const requestHash = this.checkoutRequestHash(dto, actor);
    const previous = await this.findExistingCheckout(
      this.checkoutSessions,
      dto,
      actor,
    );
    if (previous) this.assertSameRequest(previous, requestHash, actor);
    if (!previous && dto.provider !== BillingProvider.Paypal)
      throw new BadRequestException('Only PayPal checkout is supported');
    // No database connection or transaction is held while validating Legal.
    const legal = previous
      ? null
      : await this.hemiaLegal.validateAcceptance({
          organizationId: dto.organizationId,
          userId: dto.userId,
          legalAcceptanceId: dto.legalAcceptanceId,
          productCode: dto.productCode,
        });
    const creator = {
      createdByIssuer: actor.issuer,
      createdByClientId: actor.clientId,
    };
    const preparation = await this.dataSource.transaction(async (manager) => {
      await this.servicePolicy.assertContext(
        actor,
        dto.productCode,
        dto.organizationId,
        manager,
      );
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [
          `billing.checkout:${JSON.stringify([
            actor.issuer,
            actor.clientId,
            dto.organizationId,
            dto.idempotencyKey,
          ])}`,
        ],
      );
      const checkoutSessions = manager.getRepository(
        BillingCheckoutSessionEntity,
      );
      const existing = await this.findExistingCheckout(
        checkoutSessions,
        dto,
        actor,
        true,
      );
      if (existing) {
        this.assertSameRequest(existing, requestHash, actor);
        return this.reserveAttempt(manager, existing, actor);
      }
      if (!legal)
        throw new ConflictException(
          'Checkout changed; retry with the same idempotency key',
        );

      if (dto.provider !== BillingProvider.Paypal) {
        throw new BadRequestException('Only PayPal checkout is supported');
      }
      const product = await this.findActiveProduct(dto.productCode, manager);
      const plan = await this.findActivePlan(product.id, dto.planCode, manager);
      const resolved = this.planResolver.resolve(
        plan,
        dto.provider,
        dto.planPriceCode,
      );
      if (!resolved.providerPrice.providerPriceId) {
        throw new BadRequestException(
          'PayPal plan id is required for checkout',
        );
      }
      const customers = manager.getRepository(BillingCustomerEntity);
      const subscriptions = manager.getRepository(BillingSubscriptionEntity);

      let customer = await customers.findOne({
        where: {
          organizationId: dto.organizationId,
          provider: dto.provider,
        },
      });

      if (!customer) {
        // The unique active-customer index resolves races between different keys.
        await customers
          .createQueryBuilder()
          .insert()
          .values({
            organizationId: dto.organizationId,
            provider: dto.provider,
            billingEmail: dto.billingEmail ?? null,
            status: BillingCustomerStatus.Active,
          })
          .orIgnore()
          .updateEntity(false)
          .execute();
        customer = await customers.findOne({
          where: {
            organizationId: dto.organizationId,
            provider: dto.provider,
          },
        });
        if (!customer)
          throw new ConflictException(
            'Billing customer changed; retry with the same idempotency key',
          );
      }
      if (dto.billingEmail && customer.billingEmail !== dto.billingEmail) {
        await customers.update(customer.id, { billingEmail: dto.billingEmail });
        customer.billingEmail = dto.billingEmail;
      }

      const subscription = await subscriptions.save(
        subscriptions.create({
          organizationId: dto.organizationId,
          billingCustomerId: customer.id,
          billingCustomer: customer,
          planId: plan.id,
          plan,
          planPriceId: resolved.price.id,
          planPrice: resolved.price,
          providerPriceId: resolved.providerPrice.id,
          providerPrice: resolved.providerPrice,
          planPriceCode: resolved.price.code,
          productCode: product.code,
          planCode: plan.code,
          provider: dto.provider,
          providerSubscriptionId: null,
          status: SubscriptionStatus.Pending,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          nextBillingTime: null,
          cancelAtPeriodEnd: false,
          graceUntil: null,
          legalAcceptanceId: legal.legalAcceptanceId,
          acceptedAt: new Date(legal.acceptedAt),
          legalSnapshotHash: legal.legalSnapshotHash,
          metadata: { ...creator, legalEvidence: legal.evidence },
        }),
      );

      const checkoutSession = await checkoutSessions.save(
        checkoutSessions.create({
          organizationId: dto.organizationId,
          userId: dto.userId,
          productCode: product.code,
          planId: plan.id,
          plan,
          planPriceId: resolved.price.id,
          planPrice: resolved.price,
          providerPriceId: resolved.providerPrice.id,
          providerPrice: resolved.providerPrice,
          planPriceCode: resolved.price.code,
          provider: dto.provider,
          providerCheckoutUrl: null,
          status: BillingCheckoutSessionStatus.Created,
          successUrl: dto.successUrl,
          cancelUrl: dto.cancelUrl,
          legalAcceptanceId: legal.legalAcceptanceId,
          acceptedAt: new Date(legal.acceptedAt),
          legalSnapshotHash: legal.legalSnapshotHash,
          metadata: {
            ...creator,
            legalEvidence: legal.evidence,
            subscriptionId: subscription.id,
            idempotencyKey: dto.idempotencyKey,
            requestHash,
            paypalPlanId: resolved.providerPrice.providerPriceId,
            billingEmail: dto.billingEmail ?? null,
          },
        }),
      );

      const legalReference = {
        legalAcceptanceId: legal.legalAcceptanceId,
        evidence: legal.evidence,
        acceptedAt: legal.acceptedAt,
        legalSnapshotHash: legal.legalSnapshotHash,
      };

      await this.audit.record({
        manager,
        organizationId: dto.organizationId,
        actorUserId: dto.userId,
        action: 'billing.checkout.created',
        resourceType: 'billing_checkout_session',
        resourceId: checkoutSession.id,
        provider: dto.provider,
        legalReference,
        metadata: {
          ...creator,
          checkoutSessionId: checkoutSession.id,
          subscriptionId: subscription.id,
        },
      });
      await this.audit.record({
        manager,
        organizationId: dto.organizationId,
        actorUserId: dto.userId,
        action: 'billing.subscription.created',
        resourceType: 'billing_subscription',
        resourceId: subscription.id,
        provider: dto.provider,
        legalReference,
        metadata: {
          ...creator,
          checkoutSessionId: checkoutSession.id,
          subscriptionId: subscription.id,
        },
      });

      return this.reserveAttempt(manager, checkoutSession, actor);
    });
    if ('response' in preparation) return preparation.response;

    // Legal's external validation rechecks the buyer's current membership and
    // contracting permission with the consumer. Pending retries must do this
    // again; persisted results and active leases return before reaching here.
    if (previous) {
      try {
        await this.hemiaLegal.validateAcceptance({
          organizationId: preparation.checkout.organizationId,
          userId: preparation.checkout.userId,
          legalAcceptanceId: preparation.checkout.legalAcceptanceId,
          productCode: preparation.checkout.productCode,
        });
      } catch (cause: unknown) {
        return this.completeAttempt(preparation, actor, null, cause, 'legal');
      }
    }

    // The reservation is committed before contacting PayPal. These calls hold
    // neither a transaction nor a database lock, and use the frozen payload.
    let result: PaypalSubscriptionResult | null = null;
    let error: unknown;
    const { checkout, subscription } = preparation;
    try {
      result = subscription.providerSubscriptionId
        ? await this.paypal.getSubscription(subscription.providerSubscriptionId)
        : await this.paypal.createSubscription({
            providerPlanId: String(checkout.metadata.paypalPlanId),
            customId: checkout.id,
            requestId: checkout.id,
            returnUrl: checkout.successUrl,
            cancelUrl: checkout.cancelUrl,
            subscriberEmail:
              typeof checkout.metadata.billingEmail === 'string'
                ? checkout.metadata.billingEmail
                : undefined,
          });
    } catch (cause: unknown) {
      error = cause;
    }
    return this.completeAttempt(preparation, actor, result, error);
  }

  private async findExistingCheckout(
    repository: Repository<BillingCheckoutSessionEntity>,
    dto: CreateCheckoutSessionDto,
    actor: BillingServiceActor,
    lock = false,
  ): Promise<BillingCheckoutSessionEntity | null> {
    const baseQuery = () => {
      const query = repository
        .createQueryBuilder('checkout')
        .withDeleted()
        .where('checkout.organizationId = :organizationId', {
          organizationId: dto.organizationId,
        })
        .andWhere("checkout.metadata ->> 'idempotencyKey' = :key", {
          key: dto.idempotencyKey,
        });
      if (lock) query.setLock('pessimistic_write');
      return query;
    };
    // Keep the indexed namespace lookup separate from historical unowned rows.
    const existing = await baseQuery()
      .andWhere(
        "checkout.metadata ->> 'createdByIssuer' = :issuer AND checkout.metadata ->> 'createdByClientId' = :clientId",
        actor,
      )
      .getOne();
    if (existing) return existing;
    return baseQuery()
      .andWhere(
        "(checkout.metadata ->> 'createdByIssuer' IS NULL OR checkout.metadata ->> 'createdByClientId' IS NULL)",
      )
      .getOne();
  }

  private assertSameRequest(
    checkout: BillingCheckoutSessionEntity,
    requestHash: string,
    actor: BillingServiceActor,
  ): void {
    // Historical checkouts cannot be safely adopted by an arbitrary caller.
    if (
      checkout.metadata.createdByIssuer !== actor.issuer ||
      checkout.metadata.createdByClientId !== actor.clientId
    )
      throw new ConflictException(
        'Original checkout ownership is unknown; reconcile before retrying',
      );
    if (checkout.metadata.requestHash !== requestHash || checkout.deletedAt)
      throw new ConflictException(
        'Idempotency key is already used by another request or a deleted checkout',
      );
  }

  private async databaseNow(manager: EntityManager): Promise<Date> {
    const [clock] = await manager.query<Array<{ now: Date }>>(
      'SELECT clock_timestamp() AS now',
    );
    return clock.now;
  }

  private inProgress(
    checkout: BillingCheckoutSessionEntity,
    now: Date,
  ): CheckoutInProgressException {
    const expiry =
      typeof checkout.metadata.leaseUntil === 'string'
        ? Date.parse(checkout.metadata.leaseUntil)
        : now.getTime();
    const seconds = Number.isFinite(expiry)
      ? Math.max(1, Math.ceil((expiry - now.getTime()) / 1000))
      : 1;
    return new CheckoutInProgressException(checkout.id, seconds);
  }

  private async reserveAttempt(
    manager: EntityManager,
    checkout: BillingCheckoutSessionEntity,
    actor: BillingServiceActor,
  ): Promise<CheckoutReservation | { response: CheckoutSessionResponseDto }> {
    await this.servicePolicy.assertCheckout(actor, checkout, manager);
    await this.servicePolicy.assertReturnUrls(
      actor,
      checkout.successUrl,
      checkout.cancelUrl,
      manager,
    );
    const subscriptionId = this.getSubscriptionIdFromMetadata(
      checkout.metadata,
    );
    const subscription = subscriptionId
      ? await manager.getRepository(BillingSubscriptionEntity).findOne({
          where: {
            id: subscriptionId,
            organizationId: checkout.organizationId,
          },
        })
      : null;
    if (!subscription)
      throw new NotFoundException('Billing subscription not found');
    if (checkout.providerCheckoutUrl && subscription.providerSubscriptionId)
      return { response: this.toCheckoutResponse(checkout, subscription.id) };

    const now = await this.databaseNow(manager);
    const expiry =
      typeof checkout.metadata.leaseUntil === 'string'
        ? Date.parse(checkout.metadata.leaseUntil)
        : NaN;
    if (
      typeof checkout.metadata.attemptId === 'string' &&
      expiry > now.getTime()
    )
      throw this.inProgress(checkout, now);
    // Keep the original PayPal idempotency window, including the lease margin.
    if (
      !subscription.providerSubscriptionId &&
      now.getTime() + CHECKOUT_ATTEMPT_LEASE_MS >=
        checkout.createdAt.getTime() + PAYPAL_IDEMPOTENCY_WINDOW_MS
    )
      throw new ConflictException(
        'PayPal retry window expired; reconcile the original checkout before retrying',
      );

    const attemptId = randomUUID();
    checkout.metadata = {
      ...checkout.metadata,
      attemptId,
      leaseUntil: new Date(
        now.getTime() + CHECKOUT_ATTEMPT_LEASE_MS,
      ).toISOString(),
    };
    await manager.getRepository(BillingCheckoutSessionEntity).save(checkout);
    return { checkout, subscription, attemptId };
  }

  private async completeAttempt(
    reservation: CheckoutReservation,
    actor: BillingServiceActor,
    result: PaypalSubscriptionResult | null,
    providerError: unknown,
    failureSource: 'paypal' | 'legal' = 'paypal',
  ): Promise<CheckoutSessionResponseDto> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const subscriptions = manager.getRepository(BillingSubscriptionEntity);
      const checkoutSessions = manager.getRepository(
        BillingCheckoutSessionEntity,
      );
      // Subscription first: keep the same write order as checkout verification.
      const subscription = await subscriptions.findOne({
        where: {
          id: reservation.subscription.id,
          organizationId: reservation.checkout.organizationId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      const checkout = await checkoutSessions.findOne({
        where: {
          id: reservation.checkout.id,
          organizationId: reservation.checkout.organizationId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!subscription || !checkout)
        throw new NotFoundException('Billing checkout session not found');
      await this.servicePolicy.assertCheckout(actor, checkout, manager);
      await this.servicePolicy.assertReturnUrls(
        actor,
        checkout.successUrl,
        checkout.cancelUrl,
        manager,
      );
      // A completed newer attempt wins, including over an older network error.
      if (checkout.providerCheckoutUrl && subscription.providerSubscriptionId)
        return { response: this.toCheckoutResponse(checkout, subscription.id) };
      if (checkout.metadata.attemptId !== reservation.attemptId)
        throw this.inProgress(checkout, await this.databaseNow(manager));

      const alreadyLinked = Boolean(subscription.providerSubscriptionId);
      if (result) {
        if (
          subscription.providerSubscriptionId &&
          subscription.providerSubscriptionId !== result.id
        )
          throw new ConflictException(
            'PayPal subscription differs from the original checkout; reconcile before retrying',
          );
        if (!alreadyLinked) {
          // Update only the provider reference, preserving webhook status/periods.
          await subscriptions.update(subscription.id, {
            providerSubscriptionId: result.id,
          });
          subscription.providerSubscriptionId = result.id;
        }
        checkout.providerCheckoutUrl = result.approvalUrl ?? null;
      }
      const complete = Boolean(
        checkout.providerCheckoutUrl && subscription.providerSubscriptionId,
      );
      if (complete && checkout.status === BillingCheckoutSessionStatus.Failed)
        checkout.status = BillingCheckoutSessionStatus.Created;
      if (!complete && checkout.status === BillingCheckoutSessionStatus.Created)
        checkout.status = BillingCheckoutSessionStatus.Failed;
      delete checkout.metadata.attemptId;
      delete checkout.metadata.leaseUntil;
      await checkoutSessions.save(checkout);

      const metadata = {
        createdByIssuer: actor.issuer,
        createdByClientId: actor.clientId,
        checkoutSessionId: checkout.id,
        subscriptionId: subscription.id,
      };
      if (result && !alreadyLinked) {
        await this.audit.record({
          manager,
          organizationId: subscription.organizationId,
          actorUserId: checkout.userId,
          action: 'billing.subscription.provider_linked',
          resourceType: 'billing_subscription',
          resourceId: subscription.id,
          provider: checkout.provider,
          legalReference: this.toLegalReference(subscription),
          metadata,
        });
        if (complete)
          await this.audit.record({
            manager,
            organizationId: checkout.organizationId,
            actorUserId: checkout.userId,
            action: 'billing.checkout.paypal_created',
            resourceType: 'billing_checkout_session',
            resourceId: checkout.id,
            provider: checkout.provider,
            legalReference: this.toLegalReference(checkout),
            metadata,
          });
      }
      if (!complete) {
        await this.audit.record({
          manager,
          organizationId: checkout.organizationId,
          actorUserId: checkout.userId,
          action: 'billing.checkout.failed',
          resourceType: 'billing_checkout_session',
          resourceId: checkout.id,
          provider: checkout.provider,
          legalReference: this.toLegalReference(checkout),
          metadata,
        });
        return {
          error:
            providerError ??
            new BadGatewayException('PayPal approval URL is missing'),
        };
      }
      return { response: this.toCheckoutResponse(checkout, subscription.id) };
    });
    if ('error' in outcome) {
      if (failureSource === 'legal') {
        if (outcome.error instanceof Error) throw outcome.error;
        throw new BadGatewayException('Legal authorization unavailable', {
          cause: outcome.error,
        });
      }
      throw new BadGatewayException('PayPal checkout creation failed', {
        cause: outcome.error,
      });
    }
    return outcome.response;
  }

  private checkoutRequestHash(
    dto: CreateCheckoutSessionDto,
    actor: BillingServiceActor,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          actor.issuer,
          actor.clientId,
          dto.organizationId,
          dto.userId,
          dto.productCode,
          dto.planCode,
          dto.planPriceCode,
          dto.provider,
          dto.legalAcceptanceId,
          dto.successUrl,
          dto.cancelUrl,
          dto.billingEmail ?? null,
        ]),
      )
      .digest('hex');
  }

  private toCheckoutResponse(
    checkout: BillingCheckoutSessionEntity,
    subscriptionId: string,
  ): CheckoutSessionResponseDto {
    return {
      checkoutId: checkout.id,
      subscriptionId,
      checkoutUrl: checkout.providerCheckoutUrl!,
      status: checkout.status,
    };
  }

  async getCheckoutStatus(
    checkoutId: string,
    actor: BillingServiceActor,
  ): Promise<CheckoutSessionStatusResponseDto> {
    await this.servicePolicy.resolve(actor);
    const checkoutSession = await this.checkoutSessions.findOne({
      where: { id: checkoutId },
    });

    if (!checkoutSession) {
      throw new NotFoundException('Billing checkout session not found');
    }
    await this.servicePolicy.assertCheckout(actor, checkoutSession);

    const subscriptionId = this.getSubscriptionIdFromMetadata(
      checkoutSession.metadata,
    );
    const subscription = subscriptionId
      ? await this.subscriptions.findOne({ where: { id: subscriptionId } })
      : null;

    if (!subscription) {
      throw new NotFoundException('Billing subscription not found');
    }

    return {
      checkoutId: checkoutSession.id,
      subscriptionId: subscription.id,
      checkoutStatus: checkoutSession.status,
      subscriptionStatus: subscription.status,
      provider: checkoutSession.provider,
    };
  }

  private async findActiveProduct(
    productCode: string,
    manager: EntityManager,
  ): Promise<BillingProductEntity> {
    const product = await manager.getRepository(BillingProductEntity).findOne({
      where: { code: productCode, status: BillingProductStatus.Active },
    });

    if (!product) {
      throw new NotFoundException('Billing product not found');
    }

    return product;
  }

  private async findActivePlan(
    productId: string,
    planCode: string,
    manager: EntityManager,
  ): Promise<BillingPlanEntity> {
    const plan = await manager.getRepository(BillingPlanEntity).findOne({
      where: {
        productId,
        code: planCode,
        status: BillingPlanStatus.Active,
      },
      relations: {
        product: true,
        versions: {
          prices: { providerPrices: true },
          entitlements: { feature: true },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException('Billing plan not found');
    }

    return plan;
  }

  private getSubscriptionIdFromMetadata(
    metadata: Record<string, unknown>,
  ): string | null {
    return typeof metadata.subscriptionId === 'string'
      ? metadata.subscriptionId
      : null;
  }

  private toLegalReference(
    entity: BillingCheckoutSessionEntity | BillingSubscriptionEntity,
  ) {
    return {
      legalAcceptanceId: entity.legalAcceptanceId,
      evidence: Array.isArray(entity.metadata?.legalEvidence)
        ? entity.metadata.legalEvidence
        : undefined,
      acceptedAt: entity.acceptedAt,
      legalSnapshotHash: entity.legalSnapshotHash,
    };
  }
}
