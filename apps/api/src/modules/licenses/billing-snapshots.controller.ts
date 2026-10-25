import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BillingInternalAuthGuard } from '../../common/guards/billing-internal-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingServiceAccess } from '../../common/decorators/billing-service-access.decorator';
import { IsString, IsUUID, MaxLength } from 'class-validator';

export class SnapshotQueryDto {
  @IsUUID() organization_id: string;
  @IsString() @MaxLength(80) product_code: string;
}
import { BillingSnapshotsService } from './billing-snapshots.service';

@Controller('billing/integrations/v1/snapshots')
@UseGuards(BillingInternalAuthGuard, PermissionsGuard)
export class BillingSnapshotsController {
  constructor(private readonly snapshots: BillingSnapshotsService) {}
  @Get()
  @Permissions(
    'billing.integration.licenses.read',
    'billing.subscriptions.manage',
  )
  @BillingServiceAccess({
    product: 'product_code',
    organization: 'organization_id',
    source: 'query',
  })
  current(@Query() query: SnapshotQueryDto) {
    return this.snapshots.current(query.organization_id, query.product_code);
  }
}
