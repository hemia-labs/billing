import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
import { PaypalClientService } from '../paypal';
import { HemiaLegalClientService } from './clients';
import {
  CheckoutSessionResponseDto,
  CheckoutSessionStatusResponseDto,
  CreateCheckoutSessionDto,
} from './dtos';
import { BillingAuditService } from '../audit';

@Injectable()
export class BillingCheckoutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hemiaLegal: HemiaLegalClientService,
    private readonly paypal: PaypalClientService,
    private readonly audit: BillingAuditService,
    @InjectRepository(BillingCheckoutSessionEntity)
    private readonly checkoutSessions: Repository<BillingCheckoutSessionEntity>,
    @InjectRepository(BillingPlanEntity)
    private readonly plans: Repository<BillingPlanEntity>,
    @InjectRepository(BillingProductEntity)
    private readonly products: Repository<BillingProductEntity>,
    @InjectRepository(BillingSubscriptionEntity)
    private readonly subscriptions: Repository<BillingSubscriptionEntity>,
  ) {}

  async createCheckoutSession(
    dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionResponseDto> {
    if (dto.provider !== BillingProvider.Paypal) {
      throw new BadRequestException('Only PayPal checkout is supported');
    }

    const product = await this.findActiveProduct(dto.productCode);
    const plan = await this.findActivePlan(product.id, dto.planCode, dto.provider);

    if (!plan.providerPlanId) {
      throw new BadRequestException('PayPal plan id is required for checkout');
    }

    const legal = await this.hemiaLegal.validateAcceptance({
      organizationId: dto.organizationId,
      legalAcceptanceId: dto.legalAcceptanceId,
      productCode: dto.productCode,
    });

    const { checkoutSession, subscription } =
      await this.dataSource.transaction(async (manager) => {
        const customers = manager.getRepository(BillingCustomerEntity);
        const subscriptions = manager.getRepository(BillingSubscriptionEntity);
        const checkoutSessions = manager.getRepository(
          BillingCheckoutSessionEntity,
        );

        let customer = await customers.findOne({
          where: {
            organizationId: dto.organizationId,
            provider: dto.provider,
          },
        });

        if (!customer) {
          customer = customers.create({
            organizationId: dto.organizationId,
            provider: dto.provider,
            providerPayerId: null,
            payerEmail: null,
            billingEmail: dto.billingEmail ?? null,
            country: null,
            status: BillingCustomerStatus.Active,
          });
          customer = await customers.save(customer);
        } else if (dto.billingEmail && customer.billingEmail !== dto.billingEmail) {
          customer.billingEmail = dto.billingEmail;
          customer = await customers.save(customer);
        }

        const subscription = await subscriptions.save(
          subscriptions.create({
            organizationId: dto.organizationId,
            billingCustomerId: customer.id,
            billingCustomer: customer,
            planId: plan.id,
            plan,
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
            termsVersion: legal.termsVersion,
            privacyVersion: legal.privacyVersion,
            refundPolicyVersion: legal.refundPolicyVersion,
            acceptedAt: new Date(legal.acceptedAt),
            legalSnapshotHash: legal.legalSnapshotHash,
            metadata: {},
          }),
        );

        const checkoutSession = await checkoutSessions.save(
          checkoutSessions.create({
            organizationId: dto.organizationId,
            userId: dto.userId,
            productCode: product.code,
            planId: plan.id,
            plan,
            provider: dto.provider,
            providerCheckoutUrl: null,
            status: BillingCheckoutSessionStatus.Created,
            successUrl: dto.successUrl,
            cancelUrl: dto.cancelUrl,
            legalAcceptanceId: legal.legalAcceptanceId,
            termsVersion: legal.termsVersion,
            privacyVersion: legal.privacyVersion,
            refundPolicyVersion: legal.refundPolicyVersion,
            acceptedAt: new Date(legal.acceptedAt),
            legalSnapshotHash: legal.legalSnapshotHash,
            metadata: { subscriptionId: subscription.id },
          }),
        );

        const legalReference = {
          legalAcceptanceId: legal.legalAcceptanceId,
          termsVersion: legal.termsVersion,
          privacyVersion: legal.privacyVersion,
          refundPolicyVersion: legal.refundPolicyVersion,
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
            checkoutSessionId: checkoutSession.id,
            subscriptionId: subscription.id,
          },
        });

        return { checkoutSession, subscription };
      });

    try {
      const paypalSubscription = await this.paypal.createSubscription({
        providerPlanId: plan.providerPlanId,
        customId: checkoutSession.id,
        returnUrl: dto.successUrl,
        cancelUrl: dto.cancelUrl,
        subscriberEmail: dto.billingEmail,
      });

      subscription.providerSubscriptionId = paypalSubscription.id;
      checkoutSession.providerCheckoutUrl = paypalSubscription.approvalUrl ?? null;

      await this.subscriptions.save(subscription);
      await this.checkoutSessions.save(checkoutSession);
      await this.audit.record({
        organizationId: subscription.organizationId,
        actorUserId: checkoutSession.userId,
        action: 'billing.subscription.provider_linked',
        resourceType: 'billing_subscription',
        resourceId: subscription.id,
        provider: dto.provider,
        legalReference: this.toLegalReference(subscription),
        metadata: {
          checkoutSessionId: checkoutSession.id,
          subscriptionId: subscription.id,
        },
      });
      await this.audit.record({
        organizationId: checkoutSession.organizationId,
        actorUserId: checkoutSession.userId,
        action: 'billing.checkout.paypal_created',
        resourceType: 'billing_checkout_session',
        resourceId: checkoutSession.id,
        provider: dto.provider,
        legalReference: this.toLegalReference(checkoutSession),
        metadata: {
          checkoutSessionId: checkoutSession.id,
          subscriptionId: subscription.id,
        },
      });

      if (!checkoutSession.providerCheckoutUrl) {
        throw new BadGatewayException('PayPal approval URL is missing');
      }

      return {
        checkoutId: checkoutSession.id,
        subscriptionId: subscription.id,
        checkoutUrl: checkoutSession.providerCheckoutUrl,
        status: checkoutSession.status,
      };
    } catch (error) {
      checkoutSession.status = BillingCheckoutSessionStatus.Failed;
      await this.checkoutSessions.save(checkoutSession);
      await this.audit.record({
        organizationId: checkoutSession.organizationId,
        actorUserId: checkoutSession.userId,
        action: 'billing.checkout.failed',
        resourceType: 'billing_checkout_session',
        resourceId: checkoutSession.id,
        provider: dto.provider,
        legalReference: this.toLegalReference(checkoutSession),
        metadata: {
          checkoutSessionId: checkoutSession.id,
          subscriptionId: subscription.id,
        },
      });

      throw new BadGatewayException('PayPal checkout creation failed', {
        cause: error,
      });
    }
  }

  async getCheckoutStatus(
    checkoutId: string,
    organizationId?: string,
  ): Promise<CheckoutSessionStatusResponseDto> {
    const checkoutSession = await this.checkoutSessions.findOne({
      where: { id: checkoutId, ...(organizationId ? { organizationId } : {}) },
    });

    if (!checkoutSession) {
      throw new NotFoundException('Billing checkout session not found');
    }

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
  ): Promise<BillingProductEntity> {
    const product = await this.products.findOne({
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
    provider: BillingProvider,
  ): Promise<BillingPlanEntity> {
    const plan = await this.plans.findOne({
      where: {
        productId,
        code: planCode,
        provider,
        status: BillingPlanStatus.Active,
      },
      relations: { product: true },
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
      termsVersion: entity.termsVersion,
      privacyVersion: entity.privacyVersion,
      refundPolicyVersion: entity.refundPolicyVersion,
      acceptedAt: entity.acceptedAt,
      legalSnapshotHash: entity.legalSnapshotHash,
    };
  }
}
