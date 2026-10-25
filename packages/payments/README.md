# @hemia/payments

Server-side payment integration for Node.js and NestJS. Billing owns durable payment attempts, subscriptions, provider operations, and licenses. Consumers do **not** need a database, TypeORM, PostgreSQL, MySQL, a local payments schema, or a webhook to purchase and manage plans.

Keep the client secret on the server. Browser code calls its own backend with its authenticated session and CSRF protection. The backend derives organization and buyer identity; never trust browser-supplied identities.

## Install

Install `@hemia/payments` and its `@hemia/auth` peer. For the Nest adapter, use the host's NestJS11, reflect-metadata, and RxJS7. TypeORM remains an optional peer solely for the historical migration export; the active Node and Nest integrations do not import or initialize it.

## Compatibility before a consumer upgrade

The SDK requires **Billing >=1.0.1 and <2.0.0**, with the `billing.integrations.v1` contract. Deploy Billing and run its explicit migrations before adopting this SDK in a consumer such as Balanz. Publishing an npm package does not deploy Billing.

Run this read-only preflight in the consumer's deployment check against its actual Billing URL, using the same server-side connection and service credentials:

```ts
import { createPaymentsClient, MINIMUM_BILLING_VERSION } from '@hemia/payments';

const payments = createPaymentsClient({
  ...connectionFromConsole,
  clientSecret: secretFromYourServer,
});
await payments.verifyCompatibility(); // Stop the upgrade if this rejects.
console.log(`Billing satisfies ${MINIMUM_BILLING_VERSION}`);
```

The check requests `GET /billing/integrations/v1/compatibility` with the existing `billing.integration.catalog.read` scope. An old server without that route, an unsupported version/contract, invalid credentials or an unavailable server stops the check. It does not purchase, confirm, retry or cancel payments. Run it for each target environment; a GitHub/npm release alone does not prove server availability.

Nest's authenticated `/payments/integration-status` performs this check before reporting `ready: true`. `/payments/ready` only reports local module initialization and does not prove remote Billing compatibility. Normal payment calls retain their existing behavior and do not add a preflight request per transaction.

## Node.js

```ts
import { createPaymentsClient } from '@hemia/payments';

const payments = createPaymentsClient({
  ...connectionFromConsole,
  clientSecret: secretFromYourServer,
});

const plans = await payments.catalog.listPlans();
const idempotencyKey = crypto.randomUUID();
// This UUID is also the durable attemptId, known even if the first response is lost.
const attempt = await payments.attempts.create({
  idempotencyKey,
  organizationId: verifiedOrganizationId,
  userId: verifiedUserId,
  operation: 'checkout',
  planCode: selectedPlanCode,
  planPriceCode: selectedPriceCode,
  successUrl: `https://product.example/payments/success?attemptId=${idempotencyKey}`,
  cancelUrl: `https://product.example/payments/cancel?attemptId=${idempotencyKey}`,
});
```

All example identifiers come from the host application or Billing's catalog. Return URLs must use configured permitted origins. All money amounts are decimal strings.

```ts
const buyer = { organizationId: verifiedOrganizationId, userId: verifiedUserId };
await payments.attempts.get(idempotencyKey, buyer);      // Read only; never captures.
await payments.attempts.retry(idempotencyKey, buyer);    // Replays Billing's frozen intent.
await payments.attempts.confirm(idempotencyKey, buyer);  // Explicit plan-change continuation.
const license = await payments.licenses.resolve(verifiedOrganizationId);
const subscription = await payments.subscriptions.current(verifiedOrganizationId);
```

An interrupted create is recovered with its known UUID. Retry the same key and body; changing the payload under the same key is a conflict. The SDK does not create local attempts or recreate a purchase from a GET. `ready` means a provider receipt exists, not that paid access has been granted. Confirm access from Billing's license and the exact effective plan/subscription.

Core `checkout.create/status/verify` and `subscriptions.changePlan` remain low-level APIs. Prefer `attempts` for durable creation/recovery. Core types and `CheckoutAttemptResponse` are exported from the main entry point; no framework is required.

## NestJS without a database

```ts
import { PaymentsModule } from '@hemia/payments/nestjs';

PaymentsModule.forRootAsync({
  inject: [ApplicationAuthorization],
  useFactory: (authorization) => ({
    connection: connectionFromConsole, // object or Console JSON
    clientSecret: secretFromYourServer,
    authorize: (request, operation) => authorization.paymentsContext(request, operation),
    returnUrls: async (context, attemptId) => ({
      successUrl: `https://product.example/payments/success?attemptId=${attemptId}`,
      cancelUrl: `https://product.example/payments/cancel?attemptId=${attemptId}`,
    }),
  }),
});
```

The host callback must authenticate the session, active organization/membership and required permission/MFA, then return `{organizationId, subjectId, sessionId?, membershipId?}`. Operations are `plans.read`, `checkout.manage`, `subscription.manage`, `license.read`, and `legal.accept`. The host keeps its CSRF policy. Recognize `SERVICE_AUTHENTICATED_METADATA` only for service callbacks protected by the SDK's OAuth guard.

The adapter exposes these routes relative to the host's HTTP prefix:

| Method and path | Use |
| --- | --- |
| GET `/payments/ready` | Reports adapter readiness; does not run migrations or prove remote availability. |
| GET `/payments/plans` | Product catalog. |
| POST `/payments/checkout-attempts` | `{idempotencyKey,planCode,planPriceCode,legalAcceptanceId?}`. |
| GET `/payments/checkout-attempts/:id` | Buyer-bound central status. |
| POST `/payments/checkout-attempts/:id/retry` | Retry central intent; no request body. |
| POST `/payments/checkout-attempts/:id/confirm` | Explicit plan-change continuation; no request body. |
| GET `/payments/subscription` | Current commercial subscription or null. |
| GET `/payments/subscription/plan-change-quote` | Query `targetPlanCode` and `targetPlanPriceCode`. |
| POST `/payments/subscription/change-plan` | Attempt input plus `expectedSubscriptionId` and quoted `expectedAmountDueNow` for upgrades. |
| POST `/payments/subscription/cancel` | `{idempotencyKey,expectedSubscriptionId,reason?}`. |
| GET `/payments/license` | Live authoritative license, without consulting a local database. |

Create/change/retry return200 for a ready attempt,202 with `Retry-After` for pending/processing, and422 for rejected attempts. GET and confirm return the central receipt with normal200 handling. Check the response state and `statusFresh`; HTTP200 alone does not confirm a payment. Remote failures are errors, never stale implicit grants.

`/payments/access`, free trials, fiscal/business guards and local business limits are host features, not mandatory SDK tables or routes.

## Immediate upgrades and renewal-time downgrades

Get a quote using `subscriptions.planChangeQuote(id, targetPlanCode, targetPlanPriceCode)`. For an upgrade, create a `change_plan` attempt with the current `expectedSubscriptionId` and `expectedAmountDueNow` as the accepted ceiling. Billing computes the actual charge, freezes the intent, and rejects an increased amount without new approval. It supports same-currency/same-interval price changes.

After each payment-provider approval return, explicitly confirm the attempt. `planChange.action` determines the next step:

- `approve_subscription`: approve the revised recurring agreement.
- `approve_payment`: approve the one-time prorated order. A null URL means an explicit confirmation is still needed to prepare/reconcile the next step.
- `none`: no additional provider approval. Read `state` to distinguish scheduled, effective, or failed.

A canonical null URL or terminal action must not fall back to an old agreement link. Upgrades become effective after payment confirmation; future renewals stay on the new plan. Downgrades preserve the paid plan until the next renewal. Confirm the resulting license before enabling new benefits.

## Optional local synchronization: any host persistence

Local copies and webhooks are optional. The default is to read Billing remotely. If a product wants a copy, supply one atomic callback. It can use MySQL, PostgreSQL or any store supporting an atomic revision comparison; the SDK does not select a driver or execute SQL.

```ts
import { createPaymentsReceiver, snapshotAccess } from '@hemia/payments';

const receiver = createPaymentsReceiver(config, {
  onSnapshot: async (snapshot) => repository.applyIfNewer(snapshot),
});

// In a backend route: map headers, keep raw secrets out of logs.
await receiver.receive({
  authorization: request.headers.authorization,
  timestamp: request.headers['x-billing-timestamp'],
}, request.body);

// Explicit pull/resynchronization, even without a webhook:
const { snapshot } = await receiver.synchronize(verifiedOrganizationId);
const access = snapshotAccess(snapshot);
```

`PaymentSnapshot` contains `{organizationId,productCode,revision,confirmedAt,license,subscription}`. Revision is a positive decimal string. The callback must atomically compare the saved revision for **both organization and product**, replace the whole snapshot only for a greater revision, and return `{applied:boolean}`. Never overwrite a newer copy or refresh `confirmedAt` on duplicate delivery. A storage failure must throw so Billing retries delivery. Persistence is not in the payment create/confirm path, so a copy failure cannot create a second purchase.

`snapshotAccess(null)` reports `not_confirmed`. A saved snapshot grants access only while both its license validity and a fixed24-hour confirmation window remain valid; expired copies do not grant indefinitely. Use the original central `confirmedAt`, not local read time. A pull fetches a new central snapshot and applies the same callback. `payments.snapshots.current(org)` returns a validated snapshot without storing it.

Node receiver methods: `receive`, `probe`, `verifyConsole`, `verifyLegal`, `synchronize`. Signature/JWKS and live Identity introspection are both checked. Billing callbacks require `Authorization: Bearer ...` and `x-billing-timestamp` within five minutes. No HMAC secret is used. The receiver validates the configured service client, audience and scope.

For Nest, pass the same optional `onSnapshot` callback to `PaymentsModule.forRootAsync`. Without it, license delivery/probe routes return404; no local receiver is advertised. With it, GET/POST `/payments/webhooks/license` receive authenticated snapshots. Console's GET `/payments/integration-status` remains available and reports whether synchronization is configured.

## Optional Legal in Node or Nest

```ts
import { createPaymentsLegalClient } from '@hemia/payments';

const legal = createPaymentsLegalClient(config);
const prepared = await legal.prepare(verifiedContext, crypto.randomUUID());
const accepted = await legal.accept(verifiedContext, {
  requestId: prepared.requestId,
  idempotencyKey: crypto.randomUUID(),
  confirmations: prepared.documents.map(d => ({
    documentVersionId: d.documentVersionId,
    contentHash: d.contentHash,
    accepted: true,
  })),
});
```

`verifiedContext` includes organizationId, subjectId and sessionId from the host session. Render and obtain explicit consent before sending confirmations; the snippet constructs the payload only. Identity-source IDs, request IDs and evidence IDs come from Legal. Omit `legalAcceptanceId` when Legal is not used; do not send an empty string.

Node context callbacks combine `receiver.verifyLegal(headers)` and `legal.resolveContext(input)` with the host's configured `resolveContext`. Nest enables Legal only when `legal: {resolveContext}` is supplied and Console's Legal connection is complete. Routes: POST `/payments/legal/prepare`, `/accept`, `/context`. The callback recomputes current membership/contracting authority; it does not revive an expired buyer session.

## Service scopes

Core read/create scopes: `billing.integration.catalog.read`, `billing.integration.checkout.create`, `billing.integration.checkout.read`, `billing.integration.licenses.read`. Change-plan creation/retry additionally need `billing.subscriptions.manage`; explicit confirmation uses that scope. Full snapshots additionally require subscription management because they include subscription details. Console must authorize these functions per product/organization.

Legal outgoing scopes are `legal.integration.acceptances.prepare` and `.create`. Inbound scopes are `billing.webhooks.deliver`, `billing.connections.check`, and `legal.consumer_context.read`, from the configured Billing/Console/Legal clients respectively.

## Existing local-schema installations

`PaymentsSchema1792886400000` remains exported from `@hemia/payments/nestjs` for already-applied migration histories. The module no longer requires it, a DataSource, `scopeTransaction`, or legacy local payments tables. Do not delete existing tables or edit an applied migration just to update the SDK. Historical migrations and their owners/grants remain the host's responsibility; new consumers do not run them.

Publishing this SDK does not deploy Billing's central payment-attempt/snapshot APIs. Deploy and test the matching Billing version before upgrading a consumer. Test PayPal approvals and authenticated callbacks in Sandbox before enabling purchases in production.

Billing selects the configured provider; consumer checkout inputs never select it. An optional `provider` response field is informational. Approval URLs come from authenticated Billing responses and the SDK validates absolute HTTPS URLs without credentials, nonstandard ports, IP addresses, or localhost destinations. Billing validates upstream destinations against its provider adapter configuration. No provider allowlist or payment credentials are configured by a consumer.
