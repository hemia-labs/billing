import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { BillingInternalAuthGuard } from 'src/common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from 'src/common/guards/permissions.guard';
import { BillingSubscriptionAddonsController } from 'src/modules/subscription-addons/billing-subscription-addons.controller';
import { BillingSubscriptionAddonsService } from 'src/modules/subscription-addons/billing-subscription-addons.service';

describe('BillingSubscriptionAddonsController', () => {
  let controller: BillingSubscriptionAddonsController;
  let service: {
    createPendingAddon: jest.Mock;
    getSummary: jest.Mock;
    activateAddon: jest.Mock;
    scheduleCancel: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createPendingAddon: jest.fn(),
      getSummary: jest.fn(),
      activateAddon: jest.fn(),
      scheduleCancel: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingSubscriptionAddonsController],
      providers: [
        { provide: BillingSubscriptionAddonsService, useValue: service },
      ],
    })
      .overrideGuard(BillingInternalAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = moduleRef.get(BillingSubscriptionAddonsController);
  });

  it('uses internal auth and permissions guards', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      BillingSubscriptionAddonsController,
    );

    expect(guards).toEqual([BillingInternalAuthGuard, PermissionsGuard]);
  });

  it('delegates add-on endpoints to service', async () => {
    service.createPendingAddon.mockResolvedValue({
      id: 'subscription-addon-id',
    });
    service.getSummary.mockResolvedValue({ subscriptionId: 'subscription-id' });
    service.activateAddon.mockResolvedValue({ id: 'subscription-addon-id' });
    service.scheduleCancel.mockResolvedValue({ id: 'subscription-addon-id' });

    await controller.createPendingAddon('subscription-id', {
      addonCode: 'extra_user',
      quantity: 1,
    });
    await controller.getSummary('subscription-id');
    await controller.activateAddon('subscription-addon-id');
    await controller.scheduleCancel('subscription-addon-id');

    expect(service.createPendingAddon).toHaveBeenCalledWith('subscription-id', {
      addonCode: 'extra_user',
      quantity: 1,
    });
    expect(service.getSummary).toHaveBeenCalledWith('subscription-id');
    expect(service.activateAddon).toHaveBeenCalledWith('subscription-addon-id');
    expect(service.scheduleCancel).toHaveBeenCalledWith(
      'subscription-addon-id',
    );
  });
});
