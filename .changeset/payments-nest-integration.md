---
"@hemia/payments": minor
---

Add the NestJS integration for payments using an existing PostgreSQL DataSource,
Console-generated connection JSON and the application's authorization callback.
Hemia Legal is optional; a resolveContext callback uses the endpoints supplied by
Console. Checkout without legalAcceptanceId skips Legal validation, while supplied
acceptances remain validated by Billing. Include durable idempotent checkout
attempts, authenticated license updates, readiness and explicit schema migration.
