import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../auth/redis/redis.module';
import { BillingEventBusConsumer } from './transport/billing-event-bus.consumer';
import { BillingSessionInvalidationService } from './billing-session-invalidation.service';
@Module({
  imports: [ConfigModule, RedisModule],
  providers: [BillingEventBusConsumer, BillingSessionInvalidationService],
})
export class BillingEventBusModule {}
