import { NotFoundException } from '@nestjs/common';
import { BillingWebhooksService } from '../../../../apps/api/src/modules/webhooks/billing-webhooks.service';
import { BillingWebhookEventEntity } from '../../../../apps/api/src/modules/billing-shared';

function fixture(payload: Record<string, unknown> = {}) {
  const event = Object.assign(new BillingWebhookEventEntity(), {
    id: 'webhook',
    payloadJson: payload,
    leaseToken: 'internal-lease',
  });
  const events = { findOne: jest.fn().mockResolvedValue(event) };
  const logs = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
  const service = new BillingWebhooksService(
    {} as never,
    {} as never,
    {} as never,
    events as never,
    logs as never,
  );
  return { event, events, logs, service };
}

describe('webhook console detail', () => {
  it('exposes an operational allowlist without payload, personal data or internal lease', async () => {
    const f = fixture({
      create_time: '2026-10-22T12:00:00Z',
      resource_type: 'subscription',
      summary: 'Customer personal information',
      resource: {
        id: 'I-SUB',
        status: 'ACTIVE',
        plan_id: 'P-PLAN',
        start_time: '2026-10-23T12:00:00Z',
        subscriber: { email_address: 'private@example.com' },
        custom_id: 'private-customer-reference',
        amount: { value: '12345678901234567890.12', currency_code: 'MXN' },
      },
    });
    const detail = await f.service.getConsoleWebhook('webhook');
    expect(detail.summary).toEqual({
      eventCreatedAt: '2026-10-22T12:00:00Z',
      resourceType: 'subscription',
      resourceStatus: 'ACTIVE',
      planId: 'P-PLAN',
      subscriptionStartedAt: '2026-10-23T12:00:00Z',
      amount: '12345678901234567890.12',
      currency: 'MXN',
    });
    expect(detail).not.toHaveProperty('payloadJson');
    expect(detail).not.toHaveProperty('leaseToken');
    expect(JSON.stringify(detail.summary)).not.toContain('private');
  });

  it('handles missing and malformed provider fields without coercing amounts', async () => {
    const f = fixture({
      resource: {
        status: { private: 'data' },
        amount: { value: 12.34, currency_code: 'MXN' },
      },
    });
    expect((await f.service.getConsoleWebhook('webhook')).summary).toEqual({});
    f.event.payloadJson = {
      resource: { amount: { total: '12.34', currency: 'USD' } },
    };
    expect((await f.service.getConsoleWebhook('webhook')).summary).toEqual({
      amount: '12.34',
      currency: 'USD',
    });
  });

  it('does not expose personal text disguised as operational fields', async () => {
    const f = fixture({
      resource_type: 'private@example.com',
      create_time: 'customer name',
      resource: {
        status: 'private@example.com',
        plan_id: 'customer full name',
        start_time: 'customer address',
        amount: { value: 'customer', currency_code: 'MXN' },
      },
    });
    expect((await f.service.getConsoleWebhook('webhook')).summary).toEqual({});
  });

  it('paginates only this webhook manual retries and omits unrelated audit metadata', async () => {
    const f = fixture();
    const createdAt = new Date();
    f.logs.findAndCount.mockResolvedValueOnce([
      [
        {
          id: 'retry',
          actorUserId: 'actor',
          createdAt,
          metadata: {
            retryReason: 'Provider recovered',
            retryAttempt: 2,
            unrelated: 'private',
          },
        },
      ],
      24,
    ]);
    const result = await f.service.listManualRetries('webhook', {
      page: 2,
      limit: 10,
    });
    expect(f.logs.findAndCount).toHaveBeenCalledWith({
      where: {
        action: 'billing.webhook.manual_retry',
        resourceType: 'billing_webhook_event',
        resourceId: 'webhook',
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: 10,
      take: 10,
    });
    expect(result).toEqual({
      items: [
        {
          id: 'retry',
          actorUserId: 'actor',
          reason: 'Provider recovered',
          attempt: 2,
          createdAt,
        },
      ],
      total: 24,
      page: 2,
      limit: 10,
    });
  });

  it('rejects missing webhooks before querying their history', async () => {
    const f = fixture();
    f.events.findOne.mockResolvedValueOnce(null);
    await expect(
      f.service.listManualRetries('missing', { page: 1, limit: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.logs.findAndCount).not.toHaveBeenCalled();
  });
});
