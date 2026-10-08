import { Module } from '@nestjs/common';
import { BillingCatalogModule } from '../catalog/billing-catalog.module';
import { RedisModule } from '../auth/redis.module';
import { CopilotRateLimitGuard } from './copilot-rate-limit.guard';
import { BillingCopilotController } from './billing-copilot.controller';
import { BillingCopilotService } from './billing-copilot.service';
import { CopilotSessionsService } from './copilot-sessions.service';

@Module({
  imports: [BillingCatalogModule, RedisModule],
  controllers: [BillingCopilotController],
  providers: [
    BillingCopilotService,
    CopilotRateLimitGuard,
    CopilotSessionsService,
  ],
})
export class BillingCopilotModule {}
