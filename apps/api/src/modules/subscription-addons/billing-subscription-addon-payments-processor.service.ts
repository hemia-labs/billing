import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BillingAuditService } from '../audit';
import {
  BillingProvider,
  BillingSubscriptionAddonEntity,
  SubscriptionAddonStatus,
  WebhookProcessingStatus,
} from '../billing-shared';
import { BillingEntitlementsService } from '../entitlements';
import type {
  BillingWebhookProcessorInput,
  BillingWebhookProcessorResult,
} from '../webhooks/types';

@Injectable()
export class BillingSubscriptionAddonPaymentsProcessorService {
  constructor(
    private readonly entitlements: BillingEntitlementsService,
    private readonly audit: BillingAuditService,
  ) {}

  async process(
    manager: EntityManager,
    input: BillingWebhookProcessorInput,
  ): Promise<BillingWebhookProcessorResult | null> {
    const providerSubscriptionId = this.providerSubscriptionId(input.resource);
    if (!providerSubscriptionId) return null;
    const addons = manager.getRepository(BillingSubscriptionAddonEntity);
    const addon = await addons.findOne({
      where: { provider: BillingProvider.Paypal, providerSubscriptionId },
      relations: { subscription: true },
      lock: { mode: 'pessimistic_write', tables: ['subscription_addons'] },
    });
    if (!addon) return null;

    const status = this.statusFor(input.eventType, addon.status);
    if (!status || status === addon.status) {
      return { processingStatus: WebhookProcessingStatus.Processed };
    }

    const previousStatus = addon.status;
    addon.status = status;
    const saved = await addons.save(addon);
    await this.audit.record({
      manager,
      organizationId: saved.subscription.organizationId,
      action: `billing.subscription_addon.${status}`,
      resourceType: 'billing_subscription_addon',
      resourceId: saved.id,
      provider: saved.provider,
      metadata: {
        subscriptionAddonId: saved.id,
        subscriptionId: saved.subscriptionId,
        addonCode: saved.addonCode,
        previousStatus,
        newStatus: saved.status,
        webhookEventId: input.eventId,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
      },
    });
    await this.entitlements.recalculate(saved.subscriptionId, manager);
    return { processingStatus: WebhookProcessingStatus.Processed };
  }

  private statusFor(
    eventType: string,
    current: SubscriptionAddonStatus,
  ): SubscriptionAddonStatus | null {
    if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      return current === SubscriptionAddonStatus.PendingPayment
        ? SubscriptionAddonStatus.Active
        : null;
    }
    if (
      eventType === 'BILLING.SUBSCRIPTION.CANCELLED' ||
      eventType === 'BILLING.SUBSCRIPTION.EXPIRED'
    ) {
      return SubscriptionAddonStatus.Cancelled;
    }
    if (
      eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' ||
      eventType === 'BILLING.SUBSCRIPTION.SUSPENDED'
    ) {
      return SubscriptionAddonStatus.Failed;
    }
    return null;
  }

  private providerSubscriptionId(resource: Record<string, unknown>): string | null {
    const value =
      resource.id ?? resource.subscription_id ?? resource.billing_agreement_id;
    return typeof value === 'string' && value.trim() ? value : null;
  }
}
