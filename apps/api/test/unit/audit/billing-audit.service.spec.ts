import { BillingAuditLogEntity } from 'src/modules/billing-shared';
import { BillingProvider } from 'src/modules/billing-shared';
import { BillingAuditService } from 'src/modules/audit/billing-audit.service';

const createRepositoryMock = () => ({
  create: jest.fn((entity) => entity),
  save: jest.fn(async (entity) => ({ id: 'audit-id', ...entity })),
});

describe('BillingAuditService', () => {
  let repository: ReturnType<typeof createRepositoryMock>;
  let service: BillingAuditService;

  beforeEach(() => {
    repository = createRepositoryMock();
    service = new BillingAuditService(repository as never);
  });

  it('records a minimal commercial audit event', async () => {
    await service.record({
      organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
      action: 'billing.payment.created',
      resourceType: 'billing_payment',
      resourceId: '9d709aa0-09da-4d56-a71f-44fd4e917c8d',
      provider: BillingProvider.Paypal,
      metadata: { paymentId: 'payment-id' },
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: '6dfce2ed-9704-43c5-9a40-9c03a047d653',
        actorUserId: null,
        action: 'billing.payment.created',
        resourceType: 'billing_payment',
        resourceId: '9d709aa0-09da-4d56-a71f-44fd4e917c8d',
        provider: BillingProvider.Paypal,
        legalAcceptanceId: null,
        metadata: { paymentId: 'payment-id' },
      }),
    );
  });

  it('records legal reference fields when present', async () => {
    await service.record({
      action: 'billing.checkout.created',
      resourceType: 'billing_checkout_session',
      legalReference: {
        legalAcceptanceId: 'acc_123',
        termsVersion: '1.0.0',
        privacyVersion: '1.0.0',
        refundPolicyVersion: '1.0.0',
        acceptedAt: '2026-06-18T00:00:00.000Z',
        legalSnapshotHash: 'hash_123',
      },
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        legalAcceptanceId: 'acc_123',
        termsVersion: '1.0.0',
        privacyVersion: '1.0.0',
        refundPolicyVersion: '1.0.0',
        acceptedAt: new Date('2026-06-18T00:00:00.000Z'),
        legalSnapshotHash: 'hash_123',
      }),
    );
  });

  it('omits legal reference fields when absent', async () => {
    await service.record({
      action: 'billing.payment.status_changed',
      resourceType: 'billing_payment',
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        legalAcceptanceId: null,
        termsVersion: null,
        privacyVersion: null,
        refundPolicyVersion: null,
        acceptedAt: null,
        legalSnapshotHash: null,
      }),
    );
  });

  it('keeps only allowed commercial metadata keys', async () => {
    await service.record({
      action: 'billing.checkout.failed',
      resourceType: 'billing_checkout_session',
      metadata: {
        checkoutSessionId: 'checkout-id',
        ipHash: 'forbidden',
        userAgentHash: 'forbidden',
        paypalResource: { id: 'SALE-123' },
        rawPayload: { secret: true },
      },
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { checkoutSessionId: 'checkout-id' },
      }),
    );
  });

  it('uses the transaction manager repository when provided', async () => {
    const managerRepository = createRepositoryMock();

    await service.record({
      manager: {
        getRepository: (entity: unknown) => {
          if (entity === BillingAuditLogEntity) return managerRepository;
          throw new Error('Unexpected repository');
        },
      } as never,
      action: 'billing.subscription.status_changed',
      resourceType: 'billing_subscription',
    });

    expect(managerRepository.save).toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
