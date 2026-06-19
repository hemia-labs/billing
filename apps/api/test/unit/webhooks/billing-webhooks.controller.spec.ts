import { BadRequestException } from '@nestjs/common';
import { BillingWebhooksController } from 'src/modules/webhooks/billing-webhooks.controller';
import { BillingWebhooksService } from 'src/modules/webhooks/billing-webhooks.service';

describe('BillingWebhooksController', () => {
  let service: { processPaypalWebhook: jest.Mock };
  let controller: BillingWebhooksController;

  beforeEach(() => {
    service = {
      processPaypalWebhook: jest.fn().mockResolvedValue({
        eventId: 'event-id',
        providerEventId: 'WH-123',
        processingStatus: 'processed',
        duplicate: false,
      }),
    };
    controller = new BillingWebhooksController(
      service as unknown as BillingWebhooksService,
    );
  });

  it('passes PayPal headers and body to the service', async () => {
    const payload = {
      id: 'WH-123',
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: 'I-123' },
    };

    await controller.processPaypalWebhook(
      'transmission-id',
      '2026-06-18T00:00:00Z',
      'https://paypal.test/cert',
      'SHA256withRSA',
      'signature',
      payload,
    );

    expect(service.processPaypalWebhook).toHaveBeenCalledWith(
      {
        transmissionId: 'transmission-id',
        transmissionTime: '2026-06-18T00:00:00Z',
        certUrl: 'https://paypal.test/cert',
        authAlgo: 'SHA256withRSA',
        transmissionSig: 'signature',
      },
      payload,
    );
  });

  it('rejects requests missing PayPal headers', async () => {
    expect(() =>
      controller.processPaypalWebhook(
        undefined,
        '2026-06-18T00:00:00Z',
        'https://paypal.test/cert',
        'SHA256withRSA',
        'signature',
        {},
      ),
    ).toThrow(BadRequestException);
  });
});
