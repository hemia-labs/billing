import { Injectable, OnModuleInit } from '@nestjs/common';
import { BillingSubscriptionAddonsService } from './billing-subscription-addons.service';

@Injectable()
export class BillingSubscriptionAddonsWorker implements OnModuleInit {
  constructor(private readonly addons: BillingSubscriptionAddonsService) {}

  onModuleInit(): void {
    const timer = setInterval(
      () => void this.addons.processDueCancellations().catch(() => undefined),
      60_000,
    );
    timer.unref();
  }
}
