import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAuditLogEntity } from '../billing-shared';
import { BillingAuditService } from './billing-audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([BillingAuditLogEntity])],
  providers: [BillingAuditService],
  exports: [BillingAuditService],
})
export class BillingAuditModule {}
