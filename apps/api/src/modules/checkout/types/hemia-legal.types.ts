export interface ValidateLegalAcceptanceInput {
  organizationId: string;
  userId: string;
  legalAcceptanceId: string;
  productCode: string;
}

export interface HemiaLegalValidationResult {
  valid: boolean;
  legalAcceptanceId: string;
  termsVersion: string;
  privacyVersion: string;
  refundPolicyVersion: string;
  acceptedAt: string;
  legalSnapshotHash: string;
  raw: Record<string, unknown>;
}
