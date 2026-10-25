import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { BillingProvider } from '../billing-shared';
import type { BillingProviderAdapter } from './billing-provider.types';
import { PaypalBillingAdapter } from './paypal-billing.adapter';
@Injectable()
export class BillingProviderRegistry {
  constructor(private readonly paypal: PaypalBillingAdapter) {}
  get(provider: BillingProvider): BillingProviderAdapter {
    if (provider === this.paypal.provider) return this.paypal;
    throw new UnprocessableEntityException(
      'Billing provider is not implemented',
    );
  }
}
