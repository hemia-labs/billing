import { PaymentsError } from "./errors";

export const MINIMUM_BILLING_VERSION = "1.0.1";
export const BILLING_API_CONTRACT = "billing.integrations.v1";

export function billingCompatibility(value: unknown) {
  const response = value as {
    contract?: unknown;
    billingVersion?: unknown;
  } | null;
  const version = response?.billingVersion;
  if (
    response?.contract !== BILLING_API_CONTRACT ||
    typeof version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
  )
    throw new PaymentsError("compatibility", 503);
  const parts = version.split(".").map(Number);
  const minimum = MINIMUM_BILLING_VERSION.split(".").map(Number);
  const comparison =
    parts
      .map((part, index) => Math.sign(part - minimum[index]))
      .find(Boolean) ?? 0;
  if (
    !parts.every(Number.isSafeInteger) ||
    parts[0] !== minimum[0] ||
    comparison < 0
  )
    throw new PaymentsError("compatibility", 503);
  return { contract: BILLING_API_CONTRACT, billingVersion: version };
}
