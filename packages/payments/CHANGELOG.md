# @hemia/payments

## 0.4.0

### Minor Changes

- 848e27f: Add subscription management with product-scoped OAuth permissions and guarded
  NestJS endpoints for querying, changing and cancelling the current subscription.
  Plan changes use PayPal's existing agreement and apply at the next paid billing
  cycle. Preserve durable checkout idempotency, the verified actor and expected
  subscription ID across retries; reject stale confirmations and duplicate paid
  checkouts. Expose canonical pending, scheduled and effective change states,
  cancellation status and same-actor approval recovery without treating existing
  paid access as confirmation of a plan change.

## 0.3.0

### Minor Changes

- 4bff0b1: Add the NestJS integration for payments using an existing PostgreSQL DataSource,
  Console-generated connection JSON and the application's authorization callback.
  Hemia Legal is optional; a resolveContext callback uses the endpoints supplied by
  Console. Checkout without legalAcceptanceId skips Legal validation, while supplied
  acceptances remain validated by Billing. Include durable idempotent checkout
  attempts, authenticated license updates, readiness and explicit schema migration.

### Patch Changes

- 4bff0b1: Require the published @hemia/auth 1.1.0 MachineClient API and use the npm release in development and package verification.
- 4bff0b1: Preserve the configured Legal base URL prefix for prepare and accept requests by
  using MachineClient.request. Reuse the client's destination restrictions, OAuth,
  timeout, redirect and cookie handling while retaining existing Legal errors.
