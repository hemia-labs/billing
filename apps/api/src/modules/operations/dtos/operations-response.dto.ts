import {
  BillingCheckoutSessionStatus,
  BillingProvider,
  LicenseStatus,
  SubscriptionStatus,
} from '../../billing-shared';

export class ConsoleSubscriptionResponseDto {
  id: string;
  organizationId: string;
  productCode: string;
  planCode: string;
  provider: BillingProvider;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  nextBillingTime: Date | null;
  cancelAtPeriodEnd: boolean;
  graceUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ConsoleCheckoutResponseDto {
  id: string;
  organizationId: string;
  subscriptionId: string | null;
  productCode: string;
  planCode: string;
  provider: BillingProvider;
  status: BillingCheckoutSessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class ConsoleLicenseResponseDto {
  id: string;
  organizationId: string;
  productCode: string;
  planCode: string;
  subscriptionId: string | null;
  status: LicenseStatus;
  seatsLimit: number;
  usageLimit: number | null;
  features: Record<string, unknown>;
  validUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class BillingDashboardSummaryDto {
  subscriptions: Record<SubscriptionStatus, number>;
  pendingCheckouts: number;
  failedCheckouts: number;
  inactiveLicenses: number;
  pendingInvoices: number;
  failedInvoices: number;
  failedWebhooks: number;
  webhookRetries24h: number;
}
