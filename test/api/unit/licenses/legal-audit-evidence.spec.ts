import { Repository } from 'typeorm';
import { BillingAuditService } from '../../../../apps/api/src/modules/audit/billing-audit.service';
import { BillingAuditLogEntity } from '../../../../apps/api/src/modules/billing-shared';

it('persists document evidence from the legal reference in the audit', async () => {
  const repository = {
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const service = new BillingAuditService(
    repository as unknown as Repository<BillingAuditLogEntity>,
  );
  const evidence = [{ documentId: 'document', version: 'current' }];
  await service.record({
    action: 'billing.checkout.created',
    resourceType: 'billing_checkout_session',
    legalReference: {
      legalAcceptanceId: 'acceptance',
      evidence,
      acceptedAt: '2026-09-22T00:00:00Z',
      legalSnapshotHash: 'a'.repeat(64),
    },
    metadata: { legalEvidence: ['untrusted'], subscriptionId: 'subscription' },
  });
  expect(repository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: { legalEvidence: evidence, subscriptionId: 'subscription' },
    }),
  );
  const saved = repository.create.mock.calls[0][0];
  for (const key of ['termsVersion', 'privacyVersion', 'refundPolicyVersion']) {
    expect(saved).not.toHaveProperty(key);
  }
});
