import { providerRegistry } from '../../helpers/provider-registry';
import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { BillingAuditService } from '../../../../apps/api/src/modules/audit';
import { BillingProvider } from '../../../../apps/api/src/modules/billing-shared';
import { PaypalCancellationWorker } from '../../../../apps/api/src/modules/webhooks/paypal/paypal-cancellation-worker';

function fixture(paypalStatus: string | Error) {
  const job = {
    id: randomUUID(),
    organization_id: randomUUID(),
    provider_subscription_id: 'I-SUBSCRIPTION',
    provider: BillingProvider.Paypal,
    target_type: 'subscription' as const,
    target_subscription_id: randomUUID(),
    target_addon_id: null,
    source_payment_refund_id: randomUUID(),
    lease_token: randomUUID(),
    attempts: 0,
  };
  let claims = 0;
  const query = jest.fn((sql: string, _parameters?: unknown[]) => {
    void _parameters;
    if (sql.includes('WITH candidate')) {
      claims += 1;
      return Promise.resolve(claims === 1 ? [[job], 1] : [[], 0]);
    }
    if (sql.includes('UPDATE paypal_cancellation_jobs')) {
      return Promise.resolve([[{ id: job.id }], 1]);
    }
    throw new Error('Unexpected query');
  });
  const manager = { query };
  const dataSource = {
    transaction: jest.fn(
      (operation: (manager: EntityManager) => Promise<unknown>) =>
        operation(manager as unknown as EntityManager),
    ),
  };
  const paypal = {
    getSubscription:
      paypalStatus instanceof Error
        ? jest.fn().mockRejectedValue(paypalStatus)
        : jest.fn().mockResolvedValue({ status: paypalStatus }),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const worker = new PaypalCancellationWorker(
    dataSource as unknown as DataSource,
    providerRegistry(paypal),
    audit as unknown as BillingAuditService,
  );

  return { job, query, paypal, audit, worker };
}

it('completes a job when PayPal confirms the subscription is already cancelled', async () => {
  const f = fixture('CANCELLED');
  await (f.worker as unknown as { drain: () => Promise<void> }).drain();

  expect(f.paypal.getSubscription).toHaveBeenCalledWith('I-SUBSCRIPTION');
  expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  expect(f.query.mock.calls[1]?.[1]).toEqual([
    f.job.id,
    f.job.lease_token,
    true,
  ]);
  expect(f.audit.record).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'billing.refund.subscription_cancellation_completed',
      provider: BillingProvider.Paypal,
    }),
  );
});

it('keeps a cancellation pending and schedules a retry when PayPal is unavailable', async () => {
  const f = fixture(new Error('PayPal unavailable'));
  await (f.worker as unknown as { drain: () => Promise<void> }).drain();

  expect(f.paypal.getSubscription).toHaveBeenCalledTimes(1);
  expect(f.paypal.cancelSubscription).not.toHaveBeenCalled();
  expect(f.query.mock.calls[1]?.[1]).toEqual([
    f.job.id,
    f.job.lease_token,
    false,
  ]);
  expect(f.audit.record).not.toHaveBeenCalled();
});
