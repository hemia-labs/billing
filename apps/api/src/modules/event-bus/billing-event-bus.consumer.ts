import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EventBus,
  PermanentError,
  type EventBusClient,
  type EventEnvelope,
} from '@hemia/event-bus';
import {
  BILLING_ACCESS_EVENTS,
  invalidationTarget,
} from './billing-access-event.contracts';
import { BillingSessionInvalidationService } from './billing-session-invalidation.service';

@Injectable()
export class BillingEventBusConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingEventBusConsumer.name);
  private bus: EventBusClient | null = null;
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: BillingSessionInvalidationService,
  ) {}
  async onModuleInit() {
    if (!this.config.get<boolean>('eventBus.enabled')) return;
    this.bus = await EventBus.connect({
      url: this.config.getOrThrow<string>('eventBus.url'),
      serviceName: 'hemia-billing',
    });
    await this.bus.subscribe(
      { queue: 'hemia-billing.access', bindings: [...BILLING_ACCESS_EVENTS] },
      (event) => this.consume(event),
      { prefetch: this.config.get<number>('eventBus.prefetch') ?? 10 },
    );
    this.logger.log('Subscribed to hemia-billing.access');
  }
  async consume(event: EventEnvelope<unknown>) {
    if (
      event.source !== 'urn:hemia:service:hemia-access' ||
      typeof event.id !== 'string' ||
      !event.id
    )
      throw new PermanentError('Invalid Access event source or identity');
    const target = invalidationTarget(event.type, event.data);
    if (target) await this.sessions.invalidate(target);
    // No inbox marker: deletion is idempotent, and a retry must finish invalidating
    // sessions if Redis failed halfway through. Returning acknowledges completion.
  }
  async onModuleDestroy() {
    await this.bus?.close();
    this.bus = null;
  }
}
