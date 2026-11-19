import { BillingProviderRegistry } from '../../../apps/api/src/modules/providers/billing-provider.registry';
import { PaypalBillingAdapter } from '../../../apps/api/src/modules/providers/paypal-billing.adapter';
import type { PaypalClientService } from '../../../apps/api/src/modules/paypal';
export function providerRegistry(client: unknown): BillingProviderRegistry {
  const mock = client as PaypalClientService;
  if (!mock.resolveConnection)
    mock.resolveConnection = () => Promise.resolve(null);
  return new BillingProviderRegistry(
    new PaypalBillingAdapter(client as PaypalClientService),
  );
}
