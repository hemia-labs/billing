import { BillingInvoicesService } from '../../../../apps/api/src/modules/invoices/billing-invoices.service';
import { ConfigService } from '@nestjs/config';
import { NoopBillingInvoiceIssuerAdapter } from '../../../../apps/api/src/modules/invoices/adapters/noop-billing-invoice-issuer.adapter';

const adapter = (nodeEnv: string, provider?: string) =>
  new NoopBillingInvoiceIssuerAdapter(
    new ConfigService({ app: { nodeEnv }, billingFiscal: { provider } }),
  );

describe('explicitly disabled fiscal invoicing', () => {
  it.each([undefined, 'noop', 'unconfigured-pac'])(
    'refuses production startup without an explicit disabled provider: %s',
    (provider) => {
      expect(() => adapter('production', provider).onModuleInit()).toThrow(
        'BILLING_FISCAL_PROVIDER=disabled',
      );
    },
  );

  it('boots production when disabled but never simulates issuing or cancelling', async () => {
    const disabled = adapter('production', 'disabled');
    expect(() => disabled.onModuleInit()).not.toThrow();
    await expect(disabled.issue()).rejects.toMatchObject({ status: 501 });
    await expect(disabled.cancel()).rejects.toMatchObject({ status: 501 });
  });

  it.each(['issueInvoice', 'cancelInvoice'] as const)(
    'rejects %s before reserving or auditing any fiscal operation',
    async (operation) => {
      const transaction = jest.fn();
      const audit = { record: jest.fn() };
      const service = new BillingInvoicesService(
        { manager: { transaction } } as never,
        {} as never,
        audit as never,
        adapter('production', 'disabled'),
      );
      await expect(
        service[operation]('invoice-id', {
          issuer: 'https://identity.example.test',
          subject: 'operator',
          identityReferenceId: 'identity-reference',
          traceId: 'trace',
        }),
      ).rejects.toMatchObject({ status: 501 });
      expect(transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('preserves development startup without a PAC', () => {
    expect(() => adapter('development', 'noop').onModuleInit()).not.toThrow();
  });
});
