import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { BillingProvider } from '../../billing-shared';
import { CatalogPaginationQueryDto } from '../../catalog/dtos';

export class ListConsoleAuditLogsQueryDto extends CatalogPaginationQueryDto {
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  resource_type?: string;

  @IsOptional()
  @IsUUID()
  resource_id?: string;

  @IsOptional()
  @IsUUID()
  actor_user_id?: string;

  @IsOptional()
  action?: string;

  @IsOptional()
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  created_from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  created_to?: Date;
}

export class ConsoleAuditLogResponseDto {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  provider: BillingProvider | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
