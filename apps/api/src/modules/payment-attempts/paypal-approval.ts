import type { EntityManager } from 'typeorm';
import {
  BillingCheckoutSessionEntity,
  BillingCheckoutSessionStatus,
  BillingProvider,
  BillingSubscriptionEntity,
  SubscriptionStatus,
} from '../billing-shared';
import type { PaypalConnectionsService } from '../paypal-connections/paypal-connections.service';
import { providerConnectionId } from '../providers/provider-connection';
import type { BillingPaymentAttemptEntity } from './billing-payment-attempt.entity';
import type { PaymentAttemptResponse } from './payment-attempt.dto';

export type PaypalApproval = {
  kind: 'subscription';
  subscriptionId: string;
  clientId: string;
  environment: 'sandbox' | 'live';
};

/** Public SDK configuration only: never forward credentials or provider metadata. */
export function projectPaypalApproval(
  value: unknown,
  checkoutUrl?: string,
): PaypalApproval | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !checkoutUrl
  )
    return;
  const v = value as Record<string, unknown>;
  if (
    v.kind !== 'subscription' ||
    typeof v.subscriptionId !== 'string' ||
    !/^I-[A-Z0-9]{1,178}$/.test(v.subscriptionId) ||
    typeof v.clientId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(v.clientId) ||
    !['sandbox', 'live'].includes(String(v.environment))
  )
    return;
  const expectedHost =
    v.environment === 'live' ? 'www.paypal.com' : 'www.sandbox.paypal.com';
  try {
    const url = new URL(checkoutUrl);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== expectedHost ||
      url.username ||
      url.password ||
      url.port
    )
      return;
  } catch {
    return;
  }
  return {
    kind: 'subscription',
    subscriptionId: v.subscriptionId,
    clientId: v.clientId,
    environment: v.environment as PaypalApproval['environment'],
  };
}

/** Uses the existing owned checkout; it never creates, verifies or captures a provider payment. */
export async function preparePaypalApproval(
  manager: EntityManager,
  attempt: BillingPaymentAttemptEntity,
  receipt: Partial<PaymentAttemptResponse>,
  connections: PaypalConnectionsService,
): Promise<PaypalApproval | undefined> {
  if (
    attempt.requestPayload.operation !== 'checkout' ||
    attempt.requestPayload.provider !== BillingProvider.Paypal ||
    attempt.requestPayload.providerConnectionId === undefined ||
    !receipt.checkoutId ||
    !receipt.subscriptionId ||
    !receipt.checkoutUrl
  )
    return;
  const subscription = await manager
    .getRepository(BillingSubscriptionEntity)
    .findOne({
      where: {
        id: receipt.subscriptionId,
        organizationId: attempt.organizationId,
        productCode: attempt.productCode,
      },
    });
  if (
    !subscription ||
    subscription.id !== receipt.subscriptionId ||
    subscription.organizationId !== attempt.organizationId ||
    subscription.productCode !== attempt.productCode ||
    subscription.provider !== BillingProvider.Paypal ||
    subscription.status !== SubscriptionStatus.Pending ||
    subscription.metadata?.operation ||
    subscription.metadata?.renewalResume ||
    subscription.metadata?.checkoutAbandonment ||
    !subscription.providerSubscriptionId ||
    providerConnectionId(subscription.metadata) !==
      attempt.requestPayload.providerConnectionId
  )
    return;
  const checkout = await manager
    .getRepository(BillingCheckoutSessionEntity)
    .findOne({
      where: {
        id: receipt.checkoutId,
        organizationId: attempt.organizationId,
        productCode: attempt.productCode,
        userId: attempt.userId,
      },
    });
  if (
    !checkout ||
    checkout.id !== receipt.checkoutId ||
    checkout.organizationId !== attempt.organizationId ||
    checkout.productCode !== attempt.productCode ||
    checkout.userId !== attempt.userId ||
    checkout.provider !== BillingProvider.Paypal ||
    checkout.deletedAt ||
    ![
      BillingCheckoutSessionStatus.Created,
      BillingCheckoutSessionStatus.Pending,
    ].includes(checkout.status) ||
    checkout.metadata?.subscriptionId !== subscription.id ||
    checkout.metadata?.operation ||
    checkout.metadata?.renewalResume ||
    checkout.metadata?.createdByIssuer !== attempt.createdByIssuer ||
    checkout.metadata?.createdByClientId !== attempt.createdByClientId ||
    providerConnectionId(checkout.metadata) !==
      attempt.requestPayload.providerConnectionId ||
    checkout.providerCheckoutUrl !== receipt.checkoutUrl
  )
    return;
  const configuration = await connections.approvalConfiguration(
    attempt.requestPayload.providerConnectionId,
  );
  return projectPaypalApproval(
    {
      kind: 'subscription',
      subscriptionId: subscription.providerSubscriptionId,
      ...configuration,
    },
    receipt.checkoutUrl,
  );
}
