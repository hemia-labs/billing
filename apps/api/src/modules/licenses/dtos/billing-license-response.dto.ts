import { LicenseStatus } from '../../billing-shared';
import type {
  BillingAmountsSummary,
  BillingEntitlementsSummary,
} from '../../entitlements';

export class BillingLicenseResolveResponseDto {
  active: boolean;
  productCode: string;
  planCode: string | null;
  licenseStatus: LicenseStatus;
  validUntil: string | null;
  seatsLimit: number;
  usageLimit: number | null;
  features: Record<string, unknown>;
  subscriptionId: string | null;
  entitlements: BillingEntitlementsSummary;
  billing: BillingAmountsSummary;
}
