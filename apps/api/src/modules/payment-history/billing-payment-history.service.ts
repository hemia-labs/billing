import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingServicePolicyService } from '../../common/services/billing-service-policy.service';
import type { BillingServiceActor } from '../../common/types/billing-service-authorization.type';
import {
  BillingPaymentEntity,
  BillingProvider,
  PaymentStatus,
} from '../billing-shared';
import type {
  PaymentHistoryItemDto,
  PaymentHistoryPageDto,
  PaymentHistoryQueryDto,
} from './payment-history.dto';

const pageSize = 25;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const orderedAt = 'COALESCE(payment.paidAt, payment.createdAt)';
type HistoryRow = {
  id: string;
  subscriptionId: string;
  organizationId: string;
  productCode: string;
  provider: 'paypal';
  amount: string;
  currency: string;
  status: 'paid' | 'refunded' | 'reversed';
  paidAt: Date | null;
  createdAt: Date;
  reference: string | null;
  refundedAmount: string;
  operation: string | null;
  initialPayment: boolean;
};

@Injectable()
export class BillingPaymentHistoryService {
  constructor(
    @InjectRepository(BillingPaymentEntity)
    private readonly payments: Repository<BillingPaymentEntity>,
    private readonly policy: BillingServicePolicyService,
  ) {}

  async list(
    query: PaymentHistoryQueryDto,
    actor: BillingServiceActor,
  ): Promise<PaymentHistoryPageDto> {
    const organizationId = query.organization_id.toLowerCase(),
      productCode = query.product_code;
    await this.policy.assertContext(actor, productCode, organizationId);
    // Include historical contracts, including soft-deleted ones, without adopting their current plan as payment evidence.
    const builder = this.payments
      .createQueryBuilder('payment')
      .withDeleted()
      .innerJoin('payment.subscription', 'subscription')
      .where('payment.organizationId = :organizationId', { organizationId })
      .andWhere('subscription.organizationId = :organizationId', {
        organizationId,
      })
      .andWhere('subscription.productCode = :productCode', { productCode })
      .andWhere('payment.provider = :provider', {
        provider: BillingProvider.Paypal,
      })
      .andWhere('payment.status IN (:...statuses)', {
        statuses: [
          PaymentStatus.Paid,
          PaymentStatus.Refunded,
          PaymentStatus.Reversed,
        ],
      });
    if (query.cursor !== undefined) {
      const id = this.cursor(query.cursor, organizationId, productCode);
      // Resolve the exact database timestamp: JS Date would truncate PostgreSQL microseconds.
      const anchor = await builder
        .clone()
        .select(`${orderedAt}::text`, 'orderedAt')
        .andWhere('payment.id = :cursorId', { cursorId: id })
        .getRawOne<{ orderedAt: string }>();
      if (!anchor)
        throw new BadRequestException('Invalid payment history cursor');
      builder.andWhere(
        `(${orderedAt} < :cursorAt::timestamptz OR (${orderedAt} = :cursorAt::timestamptz AND payment.id < :cursorId))`,
        { cursorAt: anchor.orderedAt, cursorId: id },
      );
    }
    const rows = await builder
      .select('payment.id', 'id')
      .addSelect('payment.subscriptionId', 'subscriptionId')
      .addSelect('payment.organizationId', 'organizationId')
      .addSelect('subscription.productCode', 'productCode')
      .addSelect('payment.provider', 'provider')
      .addSelect('payment.amount', 'amount')
      .addSelect('payment.currency', 'currency')
      .addSelect('payment.status', 'status')
      .addSelect('payment.paidAt', 'paidAt')
      .addSelect('payment.createdAt', 'createdAt')
      .addSelect(
        'COALESCE(payment.providerCaptureId, payment.providerPaymentId)',
        'reference',
      )
      .addSelect("payment.metadata->>'operation'", 'operation')
      .addSelect(
        "(payment.metadata->'initialCheckoutPayment' IS NOT NULL AND payment.metadata->'initialCheckoutPayment' <> 'null'::jsonb)",
        'initialPayment',
      )
      .addSelect(
        '(SELECT COALESCE(SUM(refund.amount),0)::text FROM payment_refunds refund WHERE refund.payment_id=payment.id AND refund.provider=payment.provider::text AND refund.currency=payment.currency)',
        'refundedAmount',
      )
      .orderBy(orderedAt, 'DESC')
      .addOrderBy('payment.id', 'DESC')
      .limit(pageSize + 1)
      .getRawMany<HistoryRow>();
    const visible = rows.slice(0, pageSize);
    return {
      items: visible.map((row) => this.item(row)),
      nextCursor:
        rows.length > pageSize
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                organizationId,
                productCode,
                id: visible[visible.length - 1].id,
              }),
            ).toString('base64url')
          : null,
    };
  }

  private cursor(
    value: string,
    organizationId: string,
    productCode: string,
  ): string {
    try {
      if (
        typeof value !== 'string' ||
        value.length > 2048 ||
        !/^[A-Za-z0-9_-]+$/.test(value)
      )
        throw new Error();
      const text = Buffer.from(value, 'base64url').toString('utf8');
      if (Buffer.from(text).toString('base64url') !== value) throw new Error();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (
        !parsed ||
        Object.keys(parsed).sort().join(',') !==
          'id,organizationId,productCode,v' ||
        parsed.v !== 1 ||
        parsed.organizationId !== organizationId ||
        parsed.productCode !== productCode ||
        typeof parsed.id !== 'string' ||
        !uuid.test(parsed.id)
      )
        throw new Error();
      return parsed.id.toLowerCase();
    } catch {
      throw new BadRequestException('Invalid payment history cursor');
    }
  }

  private item(row: HistoryRow): PaymentHistoryItemDto {
    const cents = (value: string): bigint => {
      if (typeof value !== 'string' || !/^\d{1,18}(?:\.\d{1,2})?$/.test(value))
        throw new BadGatewayException('Invalid recorded payment amount');
      const [whole, fraction = ''] = value.split('.');
      return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    };
    const amount = cents(row.amount),
      refund = cents(row.refundedAmount);
    if (refund > amount)
      throw new BadGatewayException('Invalid recorded payment refund');
    const status =
      row.status === 'paid' && refund > 0n
        ? refund === amount
          ? 'refunded'
          : 'partially_refunded'
        : row.status;
    return {
      id: row.id,
      subscriptionId: row.subscriptionId,
      organizationId: row.organizationId,
      productCode: row.productCode,
      provider: row.provider,
      amount: row.amount,
      currency: row.currency,
      status,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      reference: row.reference,
      description:
        row.operation === 'plan_change_proration'
          ? 'Prorrateo por cambio de plan'
          : row.initialPayment
            ? 'Pago inicial de suscripción'
            : 'Pago de suscripción',
      ...(refund > 0n
        ? {
            refundedAmount: `${refund / 100n}.${String(refund % 100n).padStart(2, '0')}`,
          }
        : {}),
    };
  }
}
