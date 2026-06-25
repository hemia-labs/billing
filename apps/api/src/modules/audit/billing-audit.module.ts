import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAuditLogEntity } from '../billing-shared';
import { BillingAuditConsoleController } from './billing-audit-console.controller';
import { BillingAuditService } from './billing-audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([BillingAuditLogEntity])],
  controllers: [BillingAuditConsoleController],
  providers: [BillingAuditService],
  exports: [BillingAuditService],
})
export class BillingAuditModule {}
