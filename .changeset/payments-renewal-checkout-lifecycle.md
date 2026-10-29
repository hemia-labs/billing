---
"@hemia/payments": minor
---

Add client methods, request and response types, validation, and NestJS endpoints for resuming subscription renewal and changing a future renewal plan. Include pending renewal approvals, renewal plan changes and checkout attempt state in subscription and payment attempt responses.

Preserve the expected current and renewal subscription identifiers and idempotency keys throughout central payment attempts so consumers can resume the correct checkout and approval flow.
