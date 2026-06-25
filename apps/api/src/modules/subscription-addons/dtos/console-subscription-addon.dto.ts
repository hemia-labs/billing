import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class CreateConsoleSubscriptionAddonDto {
  @IsString()
  @MaxLength(100)
  addonCode: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  @MaxLength(120)
  idempotencyKey: string;
}

export class ConsoleSubscriptionAddonResponseDto {
  id: string;
  addonCode: string;
  quantity: number;
  status: string;
  unitPrice: string;
  currency: string;
  pendingEffectiveAt: Date | null;
  currentPeriodEnd: Date | null;
}

export class ConsoleSubscriptionAddonSummaryDto {
  subscriptionId: string;
  planCode: string;
  baseAmount: string;
  addonsAmount: string;
  totalAmount: string;
  currency: string;
  addons: ConsoleSubscriptionAddonResponseDto[];
}

export class ConsoleSubscriptionAddonApprovalDto {
  addon: ConsoleSubscriptionAddonResponseDto;
  approvalUrl: string | null;
}
