import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BillingWebhookEventEntity } from 'src/modules/billing-shared';
import {
  BillingProvider,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from 'src/modules/billing-shared';
import { PaypalClientService } from 'src/modules/webhooks/paypal';
import { BillingSubscriptionPaymentsProcessorService } from 'src/modules/webhooks/billing-subscription-payments-processor.service';
import { BillingWebhooksService } from 'src/modules/webhooks/billing-webhooks.service';
import { PaypalWebhookHeaders } from 'src/modules/webhooks/types';

const headers: PaypalWebhookHeaders = {
  transmissionId: 'transmission-id',
  transmissionTime: '2026-06-18T00:00:00Z',
  certUrl: 'https://paypal.test/cert',
  authAlgo: 'SHA256withRSA',
  transmissionSig: 'signature',
};

const createEvent = (
  overrides: Partial<BillingWebhookEventEntity> = {},
): BillingWebhookEventEntity =>
  ({
    id: 'event-row-id',
    provider: BillingProvider.Paypal,
    providerEventId: 'WH-123',
    eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
    resourceId: 'I-123',
    transmissionId: 'transmission-id',
    verificationStatus: WebhookVerificationStatus.Verified,
    processingStatus: WebhookProcessingStatus.Pending,
    payloadJson: {},
    errorMessage: null,
    receivedAt: new Date('2026-06-18T00:00:00Z'),
    processedAt: null,
    ...overrides,
  }) as BillingWebhookEventEntity;

const createRepositoryMock = () => ({
  create: jest.fn((entity) => entity),
  findOne: jest.fn(),
  save: jest.fn(async (entity) => ({ id: entity.id ?? 'saved-id', ...entity })),
});

describe('BillingWebhooksService', () => {
  let dataSource: { transaction: jest.Mock };
  let paypal: { verifyWebhook: jest.Mock };
  let processor: { process: jest.Mock };
  let webhookEvents: ReturnType<typeof createRepositoryMock>;
  let managerWebhookEvents: ReturnType<typeof createRepositoryMock>;
  let service: BillingWebhooksService;

  beforeEach(() => {
    webhookEvents = createRepositoryMock();
    managerWebhookEvents = createRepositoryMock();
    paypal = {
      verifyWebhook: jest.fn().mockResolvedValue({ verified: true }),
    };
    processor = {
      process: jest.fn().mockResolvedValue({
        processingStatus: WebhookProcessingStatus.Processed,
      }),
    };
    dataSource = {
      transaction: jest.fn(async (callback) =>
        callback({
          getRepository: (entity: unknown) => {
            if (entity === BillingWebhookEventEntity) return managerWebhookEvents;
            throw new Error('Unexpected repository');
          },
        }),
      ),
    };
    service = new BillingWebhooksService(
      dataSource as unknown as DataSource,
      paypal as unknown as PaypalClientService,
      processor as unknown as BillingSubscriptionPaymentsProcessorService,
      webhookEvents as never,
    );
  });

  it('rejects missing PayPal headers', async () => {
    await expect(
      service.processPaypalWebhook(
        { ...headers, transmissionSig: '' },
        { id: 'WH-123', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: {} },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores failed event when signature verification fails', async () => {
    paypal.verifyWebhook.mockResolvedValue({ verified: false });
    webhookEvents.findOne.mockResolvedValue(null);

    const result = await service.processPaypalWebhook(headers, {
      id: 'WH-123',
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: 'I-123' },
    });

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(processor.process).not.toHaveBeenCalled();
    expect(webhookEvents.save).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEventId: 'WH-123',
        verificationStatus: WebhookVerificationStatus.Failed,
        processingStatus: WebhookProcessingStatus.Failed,
      }),
    );
    expect(result.processingStatus).toBe(WebhookProcessingStatus.Failed);
  });

  it('does not reprocess a duplicate processed event', async () => {
    managerWebhookEvents.findOne.mockResolvedValue(
      createEvent({ processingStatus: WebhookProcessingStatus.Processed }),
    );

    const result = await service.processPaypalWebhook(headers, {
      id: 'WH-123',
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: 'I-123' },
    });

    expect(result.duplicate).toBe(true);
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('reprocesses a failed event and clears its error', async () => {
    managerWebhookEvents.findOne.mockResolvedValue(
      createEvent({
        processingStatus: WebhookProcessingStatus.Failed,
        errorMessage: 'previous failure',
      }),
    );
    processor.process.mockResolvedValue({
      processingStatus: WebhookProcessingStatus.Ignored,
    });

    const result = await service.processPaypalWebhook(headers, {
      id: 'WH-123',
      event_type: 'UNKNOWN.EVENT',
      resource: { id: 'I-123' },
    });

    expect(result.duplicate).toBe(false);
    expect(managerWebhookEvents.save).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStatus: WebhookProcessingStatus.Ignored,
        errorMessage: null,
      }),
    );
  });

  it('delegates verified events to the processor', async () => {
    managerWebhookEvents.findOne.mockResolvedValue(null);

    await service.processPaypalWebhook(headers, {
      id: 'WH-123',
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: 'I-123' },
    });

    expect(processor.process).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: 'saved-id',
        providerEventId: 'WH-123',
        eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: { id: 'I-123' },
      }),
    );
  });

  it('stores processor failure as webhook failed', async () => {
    processor.process.mockRejectedValue(new Error('PayPal API failed'));

    const result = await service.processPaypalWebhook(headers, {
      id: 'WH-123',
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: 'I-123' },
    });

    expect(result.processingStatus).toBe(WebhookProcessingStatus.Failed);
    expect(managerWebhookEvents.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        processingStatus: WebhookProcessingStatus.Failed,
        errorMessage: 'PayPal API failed',
      }),
    );
  });

  it('stores unknown verified events as ignored with note', async () => {
    processor.process.mockResolvedValue({
      processingStatus: WebhookProcessingStatus.Ignored,
      note: 'Unsupported event',
    });

    const result = await service.processPaypalWebhook(headers, {
      id: 'WH-UNKNOWN',
      event_type: 'UNKNOWN.EVENT',
      resource: { id: 'resource-id' },
    });

    expect(result.processingStatus).toBe(WebhookProcessingStatus.Ignored);
    expect(managerWebhookEvents.save).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStatus: WebhookProcessingStatus.Ignored,
        errorMessage: 'Unsupported event',
      }),
    );
  });
});
