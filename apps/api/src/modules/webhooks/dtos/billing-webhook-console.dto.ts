import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  BillingProvider,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '../../billing-shared';
import { CatalogPaginationQueryDto } from '../../catalog/dtos';

export class ListConsoleWebhooksQueryDto extends CatalogPaginationQueryDto {
  @IsOptional()
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @IsOptional()
  event_type?: string;

  @IsOptional()
  @IsEnum(WebhookProcessingStatus)
  processing_status?: WebhookProcessingStatus;

  @IsOptional()
  @IsEnum(WebhookVerificationStatus)
  verification_status?: WebhookVerificationStatus;

  @IsOptional()
  provider_event_id?: string;

  @IsOptional()
  resource_id?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  received_from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  received_to?: Date;
}

export class RetryWebhookDto {
  @IsString()
  @MaxLength(250)
  reason: string;
}

export class ConsoleWebhookResponseDto {
  id: string;
  provider: BillingProvider;
  providerEventId: string;
  eventType: string;
  resourceId: string | null;
  verificationStatus: WebhookVerificationStatus;
  processingStatus: WebhookProcessingStatus;
  errorMessage: string | null;
  attempts: number;
  nextRetryAt: Date;
  lockedUntil: Date | null;
  requiresManualReview: boolean;
  receivedAt: Date;
  processedAt: Date | null;
}

export class ConsoleWebhookDetailResponseDto extends ConsoleWebhookResponseDto {
  transmissionId: string | null;
  references: Record<string, string>;
  summary: Record<string, string>;
}

export class ConsoleWebhookManualRetryResponseDto {
  id: string;
  actorUserId: string | null;
  reason: string | null;
  attempt: number | null;
  createdAt: Date;
}
