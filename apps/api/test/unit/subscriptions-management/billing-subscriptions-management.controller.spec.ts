import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { BillingInternalAuthGuard } from 'src/common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from 'src/common/guards/permissions.guard';
import { BillingSubscriptionsManagementController } from 'src/modules/subscriptions-management/billing-subscriptions-management.controller';
import { BillingSubscriptionsManagementService } from 'src/modules/subscriptions-management/billing-subscriptions-management.service';

describe('BillingSubscriptionsManagementController', () => {
  let controller: BillingSubscriptionsManagementController;
  let service: {
    getCurrentSubscription: jest.Mock;
    cancelSubscription: jest.Mock;
    changePlan: jest.Mock;
    verifyCheckoutSession: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getCurrentSubscription: jest.fn(),
      cancelSubscription: jest.fn(),
      changePlan: jest.fn(),
      verifyCheckoutSession: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingSubscriptionsManagementController],
      providers: [
        { provide: BillingSubscriptionsManagementService, useValue: service },
      ],
    })
      .overrideGuard(BillingInternalAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = moduleRef.get(BillingSubscriptionsManagementController);
  });

  it('uses internal auth and permissions guards', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      BillingSubscriptionsManagementController,
    );

    expect(guards).toEqual([BillingInternalAuthGuard, PermissionsGuard]);
  });

  it('delegates subscription management endpoints to service', async () => {
    service.getCurrentSubscription.mockResolvedValue({ id: 'subscription-id' });
    service.cancelSubscription.mockResolvedValue({ id: 'subscription-id' });
    service.changePlan.mockResolvedValue({ checkoutId: 'checkout-id' });
    service.verifyCheckoutSession.mockResolvedValue({
      checkoutId: 'checkout-id',
    });

    await controller.getCurrent({
      organization_id: 'organization-id',
      product_code: 'medsync',
    });
    await controller.cancel('subscription-id', { reason: 'No longer needed' });
    await controller.changePlan('subscription-id', {
      targetPlanCode: 'medsync_plus_monthly',
      legalAcceptanceId: 'legal-1',
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
    });
    await controller.verify('checkout-id');

    expect(service.getCurrentSubscription).toHaveBeenCalledWith(
      'organization-id',
      'medsync',
    );
    expect(service.cancelSubscription).toHaveBeenCalledWith('subscription-id', {
      reason: 'No longer needed',
    });
    expect(service.changePlan).toHaveBeenCalledWith(
      'subscription-id',
      expect.objectContaining({ targetPlanCode: 'medsync_plus_monthly' }),
    );
    expect(service.verifyCheckoutSession).toHaveBeenCalledWith('checkout-id');
  });
});
