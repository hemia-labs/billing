export interface ValidateLegalAcceptanceInput {
  organizationId: string;
  userId: string;
  legalAcceptanceId: string;
  productCode: string;
}

export interface HemiaLegalValidationResult {
  valid: boolean;
  legalAcceptanceId: string;
  evidence: Record<string, unknown>[];
  acceptedAt: string;
  legalSnapshotHash: string;
  raw: Record<string, unknown>;
}
