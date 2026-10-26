# @hemia/payments

## 0.9.0

### Minor Changes

- 01cc47b: Add an explicit read-only verifyCompatibility preflight requiring Billing >=1.0.1 and <2.0.0. Verify the deployed server contract before Nest reports integration readiness, and document server-first consumer upgrades independently of npm publication.

## 0.8.0

### Minor Changes

- f95840a: Add buyer-bound cancellation of central payment attempts and expose cancellationRequested in plan-change state. Preserve approval recovery when a cancelled change requires restoring the existing subscription, with authorization checks before transport.

## 0.7.0

### Minor Changes

- 9ecf45e: Let Billing choose the payment provider. Remove provider selection from checkout requests, retain optional provider metadata, and validate provider-neutral HTTPS approval URLs without requiring provider setup in consumers.

## 0.6.0

### Minor Changes

- cace991: Centralize durable payment attempts in Billing and remove mandatory databases from Node and Nest consumers. Add optional authenticated subscription/license snapshot receivers and synchronization callbacks for product-owned MySQL or PostgreSQL copies. Export framework-free Legal operations and freshness-aware snapshot access. Existing consumers should deploy Billing's central attempt migration and endpoints before upgrading; local schema migration exports remain historical and are no longer required by the Nest module.

## 0.5.1

### Patch Changes

- 6e352c3: Preserve PostgreSQL checkout receipts when plan changes no longer require approval, hide obsolete approval links, and retain timestamp precision when refreshing payment status.

## 0.5.0

### Minor Changes

- 9db58bd: Add server-quoted immediate upgrades with prorated PayPal payments, renewal-time downgrades, accepted amount ceilings, and explicit authenticated plan-change confirmation. Read-only attempt polling preserves payment continuation URLs without creating or capturing purchases.

## 0.4.1

### Patch Changes

- a2ae167: Clarify the English README with a step-by-step setup guide, separate Node.js and
  NestJS integration paths, and concise checkout, subscription and webhook references.

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
