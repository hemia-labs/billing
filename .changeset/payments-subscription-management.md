---
"@hemia/payments": minor
---

Add subscription management with product-scoped OAuth permissions and guarded
NestJS endpoints for querying, changing and cancelling the current subscription.
Plan changes use PayPal's existing agreement and apply at the next paid billing
cycle. Preserve durable checkout idempotency, the verified actor and expected
subscription ID across retries; reject stale confirmations and duplicate paid
checkouts. Expose canonical pending, scheduled and effective change states,
cancellation status and same-actor approval recovery without treating existing
paid access as confirmation of a plan change.
