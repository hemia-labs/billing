# @hemia/payments

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
