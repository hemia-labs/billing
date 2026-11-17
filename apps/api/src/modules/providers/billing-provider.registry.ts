import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { BillingProvider } from '../billing-shared';
import type { BillingProviderAdapter } from './billing-provider.types';
import { PaypalBillingAdapter } from './paypal-billing.adapter';
@Injectable()
export class BillingProviderRegistry {
  constructor(private readonly paypal: PaypalBillingAdapter) {}
  async resolveConnection(
    provider: BillingProvider,
    productCode: string,
  ): Promise<string | null> {
    this.get(provider);
    return provider === this.paypal.provider
      ? this.paypal.resolveConnection(productCode)
      : null;
  }
  get(
    provider: BillingProvider,
    connectionId?: string | null,
  ): BillingProviderAdapter {
    if (provider === this.paypal.provider)
      return this.paypal.forConnection(connectionId);
    throw new UnprocessableEntityException(
      'Billing provider is not implemented',
    );
  }
}
