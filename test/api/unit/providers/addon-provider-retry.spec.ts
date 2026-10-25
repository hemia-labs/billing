import { BillingSubscriptionAddonsService } from '../../../../apps/api/src/modules/subscription-addons/billing-subscription-addons.service';
import {
  BillingSubscriptionAddonEntity,
  BillingProvider,
  SubscriptionAddonStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import { SubscriptionAddonMapper } from '../../../../apps/api/src/modules/subscription-addons/mappers';
import { providerRegistry } from '../../helpers/provider-registry';

it('retains the original add-on attempt time after timeout and refuses a new provider create beyond its retention window', async () => {
  jest.useFakeTimers({ now: new Date('2030-01-01') });
  try {
    const entity = Object.assign(new BillingSubscriptionAddonEntity(), {
      id: 'addon',
      subscriptionId: 'subscription',
      addonCode: 'seats',
      quantity: 1,
      idempotencyKey: 'same-key',
      provider: BillingProvider.Paypal,
      providerReferenceId: 'P-ADDON',
      providerSubscriptionId: null,
      status: SubscriptionAddonStatus.PendingPayment,
      metadata: {},
      createdAt: new Date(),
      subscription: { organizationId: 'organization' },
    });
    const repo = {
      findOne: () => Promise.resolve(entity),
      save: (row: BillingSubscriptionAddonEntity) =>
        Promise.resolve(Object.assign(entity, row)),
    };
    const manager = { getRepository: () => repo };
    const ds = {
      transaction: <T>(work: (manager: typeof manager) => Promise<T>) =>
        work(manager),
    };
    const client = {
      createSubscription: jest.fn(() =>
        Promise.reject(new Error('response lost')),
      ),
    };
    const service = new BillingSubscriptionAddonsService(
      repo as never,
      null as never,
      null as never,
      null as never,
      { record: () => Promise.resolve() } as never,
      null as never,
      providerRegistry(client),
      { get: () => 'https://consumer.test' } as never,
      ds as never,
      null as never,
    );
    jest
      .spyOn(service, 'createPendingAddon')
      .mockResolvedValue(SubscriptionAddonMapper.toDto(entity));
    const dto = { addonCode: 'seats', quantity: 1, idempotencyKey: 'same-key' };
    await expect(
      service.createApproval('subscription', dto, 'buyer'),
    ).rejects.toThrow('response lost');
    expect(entity.metadata.providerAttemptStartedAt).toBe(
      '2030-01-01T00:00:00.000Z',
    );
    jest.setSystemTime(new Date('2030-01-05'));
    await expect(
      service.createApproval('subscription', dto, 'buyer'),
    ).rejects.toMatchObject({ status: 409 });
    expect(entity.metadata.providerAttemptStartedAt).toBe(
      '2030-01-01T00:00:00.000Z',
    );
    expect(client.createSubscription).toHaveBeenCalledTimes(1);
    // A legacy crash can leave PendingPayment without an attempt marker after the provider accepted it.
    entity.metadata = {};
    entity.status = SubscriptionAddonStatus.PendingPayment;
    await expect(
      service.createApproval('subscription', dto, 'buyer'),
    ).rejects.toMatchObject({ status: 409 });
    expect(client.createSubscription).toHaveBeenCalledTimes(1);
    await expect(
      service.createApproval(
        'subscription',
        { addonCode: 'seats', quantity: 1 },
        'buyer',
      ),
    ).rejects.toMatchObject({ status: 400 });
  } finally {
    jest.useRealTimers();
  }
});
