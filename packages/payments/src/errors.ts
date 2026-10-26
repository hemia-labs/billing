/** Safe diagnostic metadata only; never includes upstream payloads or credentials. */
export class PaymentsError extends Error {
  constructor(
    public readonly code:
      | "compatibility"
      | "configuration"
      | "transport"
      | "authentication"
      | "http"
      | "contract"
      | "CHECKOUT_IN_PROGRESS",
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`Payments ${code}${status ? ` (${status})` : ""}`);
    this.name = "PaymentsError";
  }
}
