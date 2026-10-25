import { Module } from '@nestjs/common';
import { PaypalModule } from '../paypal';
import { PaypalBillingAdapter } from './paypal-billing.adapter';
import { BillingProviderRegistry } from './billing-provider.registry';
@Module({
  imports: [PaypalModule],
  providers: [PaypalBillingAdapter, BillingProviderRegistry],
  exports: [BillingProviderRegistry],
})
export class BillingProvidersModule {}
