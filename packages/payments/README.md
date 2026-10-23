# @hemia/payments

Connect your backend to Hemia Billing to list plans, start checkout, manage
subscriptions and check paid access. Billing handles payment providers; your
application handles its users, permissions and UI.

Choose the integration that fits your backend:

| Import | Use it for |
| --- | --- |
| `@hemia/payments` | A server-side client for any Node.js backend. |
| `@hemia/payments/nestjs` | Ready-to-use NestJS routes, stored checkout attempts and license webhooks. Requires PostgreSQL and your existing TypeORM DataSource. |

## 1. Install

Requires Node.js **20.19 or later**.

```sh
npm install @hemia/payments @hemia/auth@^1.1.0
```

For the NestJS integration, your application also needs NestJS 11, TypeORM
(`>=0.3.0 <2`), `reflect-metadata` and `rxjs`. These are optional peers and are
not loaded by the core import.

## 2. Configure in Console

Before connecting the SDK:

1. In Billing, publish a plan with an active price and payment-provider mapping.
2. In Console, select your backend client, product and payment functions. Set the
   authorized organizations, checkout return URLs and backend base URL, including
   its API prefix (for example, `https://api.example.com/api`). Enable subscription
   management if your application needs plan changes or cancellation.
3. Copy the generated `PAYMENTS_CONNECTION` JSON into your backend configuration.
   Load `HEMIA_CLIENT_SECRET` separately from your existing secret provider.

Keep both values on the server. Use the connection for the environment you are
running; do not build its service URLs, audiences or scopes by hand.

## 3. Connect your backend

### Any Node.js backend

```ts
import { createPaymentsClient } from '@hemia/payments';

const payments = createPaymentsClient({
  ...JSON.parse(process.env.PAYMENTS_CONNECTION!),
  clientSecret: process.env.HEMIA_CLIENT_SECRET!,
});

const plans = await payments.catalog.listPlans();
```

Call this client from your authorized backend handlers. Derive organization and
user IDs from the authenticated session, rather than trusting browser input.

| Method | Purpose |
| --- | --- |
| `catalog.listPlans()` | Read plans, prices and benefits. |
| `checkout.create(input)` | Start a purchase with a persisted idempotency key. |
| `checkout.status(checkoutId)` | Read a checkout's status. |
| `subscriptions.current(organizationId)` | Read the current subscription, or `null` if there is none. |
| `subscriptions.changePlan(subscriptionId, input)` | Request a plan change. |
| `subscriptions.cancel(subscriptionId, input)` | Request cancellation. |
| `licenses.resolve(organizationId)` | Check paid access for the configured product. |

Checkout input includes `organizationId`, `userId`, `planCode`, `planPriceCode`
and `idempotencyKey`. Both `successUrl` and `cancelUrl` must be present in the
connection or supplied in the request. See the exported TypeScript types for the
full method signatures.

### NestJS with PostgreSQL

Register the module in your application. The configuration and authentication
services below are your application's existing services; their method names are
illustrative.

```ts
import { PaymentsModule } from '@hemia/payments/nestjs';

PaymentsModule.forRootAsync({
  imports: [ConfigModule, AuthModule],
  inject: [ConfigService, AuthService],
  useFactory: (config, auth) => ({
    connection: config.getOrThrow('PAYMENTS_CONNECTION'),
    clientSecret: config.getOrThrow('HEMIA_CLIENT_SECRET'),
    authorize: (request, operation) => auth.authorizePayments(request, operation),
  }),
});
```

The `authorize` callback must check the session, active membership, permissions
and any required MFA, then return:

```ts
type AuthorizedContext = {
  organizationId: string;
  subjectId: string;
  sessionId?: string;
  membershipId?: string;
};
```

Supported operations are `plans.read`, `checkout.manage`, `subscription.manage`,
`license.read` and `legal.accept`. Keep your CSRF/origin protection on user
mutation routes. The SDK derives user and organization identity from this
callback, not from the checkout body.

The module reuses your exported default `DataSource`. Import your database module
if it is not global, or pass `dataSource` explicitly for a named connection.
Register `PaymentsSchema1792886400000` from `@hemia/payments/nestjs` in your
TypeORM migration list and run your normal migration command **before deployment**.
The module never starts a database connection or runs migrations for you.

## Checkout flow

For NestJS, call these routes under your application's API prefix:

| Route | Purpose |
| --- | --- |
| `GET /payments/plans` | List plans and prices. |
| `POST /payments/checkout-attempts` | Start a purchase. |
| `GET /payments/checkout-attempts/:id` | Read the stored attempt and refresh its status. |
| `POST /payments/checkout-attempts/:id/retry` | Retry the same stored request. |
| `GET /payments/license` | Read the local paid-access result. |

1. Let the user choose a plan and price.
2. Create and persist one UUID idempotency key for that purchase attempt. Send
   `{ idempotencyKey, planCode, planPriceCode }` to the checkout route.
3. Save the returned `attemptId`. When `status` is `ready`, redirect to
   `checkoutUrl`. For `pending` or `processing`, respect `Retry-After` and read the
   attempt again. These responses use HTTP 202; rejected attempts use HTTP 422.
4. After the return redirect, check `/payments/license` before granting access.
   A successful redirect or provider approval alone does not confirm paid access.

The core client does not persist attempts; your application must store the
request and key. The NestJS integration stores them in PostgreSQL. Neither
integration automatically retries purchase requests: after a timeout, explicitly
retry the same attempt instead of creating a new key.

## Plan changes and cancellation

Subscription management requires Console to grant
`billing.subscriptions.manage`. With NestJS, authorize `subscription.manage` and
use these routes:

| Route | Purpose |
| --- | --- |
| `GET /payments/subscription` | Read the plan, billing dates and pending changes. |
| `POST /payments/subscription/change-plan` | Send checkout-attempt fields plus `expectedSubscriptionId`. |
| `POST /payments/subscription/cancel` | Send `{ idempotencyKey, expectedSubscriptionId, reason? }`. |

Use the current subscription ID as `expectedSubscriptionId`. The SDK rejects a
stale confirmation if the subscription changed while the user was deciding.

Plan changes use the existing PayPal agreement and apply at the next paid cycle.
If approval is required, follow the returned checkout URL and read the attempt
again. Display the returned `pendingPlanChange.state` and `effectiveAt`; an
existing active license does not prove the new plan is effective.

For cancellation, display `cancellation.state`, `cancellation.effectiveAt` and
`currentPeriodEnd`. A pending request is not yet a scheduled cancellation. Once
scheduled, the subscription keeps its paid access through the period end without
renewing. Use `nextBillingTime` for renewal dates, and the license result to decide
whether access is currently allowed. Trials remain your application's responsibility.

## Optional: Hemia Legal

Skip this section if your application manages documents itself. Omit
`legalAcceptanceId` from checkout and leave the module's `legal` option unset.

To use Hemia Legal:

1. Publish your documents and acceptance rules in Legal.
2. Select the collector, application, documents and source identity namespace in
   Console. The namespace must match your application's identity contract.
3. Add `legal: { resolveContext }` to the module options. Your callback checks the
   current user, membership, MFA and permission to contract. The SDK reads Legal
   endpoints from `connection.legal`.
4. Use `POST /payments/legal/prepare` to load the documents, show them to the user,
   then call `POST /payments/legal/accept` with their explicit confirmations.
   Pass the returned acceptance ID as `legalAcceptanceId` when creating checkout.

Legal routes return 404 when disabled. Billing validates every supplied acceptance,
including one obtained outside this module. Never fabricate an acceptance ID.

## Webhooks and operations

Console configures the standard receiver and verification routes from your backend
base URL. The NestJS module exposes:

| Route | Purpose |
| --- | --- |
| `GET/POST /payments/webhooks/license` | Authenticated receiver probe and license updates. |
| `GET /payments/integration-status` | Console-authenticated connection check. |
| `GET /payments/ready` | Check the installed schema without migrating it. |
| `POST /payments/legal/context` | Authenticated Legal context callback, when enabled. |

Machine routes require the configured receiver, valid token signature, exact
client/audience/scope and current token introspection. License webhooks also
require a fresh timestamp. The SDK rejects older license updates; the local
license check enforces expiry and a 24-hour confirmation freshness limit.

<details>
<summary>Advanced configuration</summary>

- NestJS `connection` accepts JSON or an object. Use `returnUrls(context, attemptId)`
  for dynamic return paths within the configured origins.
- `allowHttpLoopback` works only outside production. Timeouts default to five
  seconds and are capped at 30 seconds. Errors expose sanitized `code`, optional
  HTTP `status` and bounded `retryAfterSeconds`.
- The migration creates `payments_checkout_attempts`, `payments_licenses` and
  `payments_apply_license`. Configure runtime grants and any RLS policies in your
  own migrations. Grant function execution only to the intended runtime role;
  never expose these tables to browser clients. `scopeTransaction` supports
  transaction-local database roles.
- `SERVICE_AUTHENTICATED_METADATA` marks machine routes for host guards. The SDK
  still verifies their service tokens. Catalog-only setup needs no receiver;
  machine routes fail closed until one is configured.

</details>

## Development and releases

From the Billing repository, build and test the package with:

```sh
bun run --cwd packages/payments typecheck
bun run --cwd packages/payments build
bun run --cwd packages/payments test
bun run --cwd packages/payments test:nest
bun run test:payments:tarball
```

The disposable PostgreSQL integration suite is at
`test/payments/integration/atlas/verify.sh`. Releases use Changesets and a separate
version PR; see [release operations](https://github.com/hemia-labs/billing/blob/main/docs/payments-release.md).

## Prorated plan changes

`subscriptions.planChangeQuote(subscriptionId, targetPlanCode, targetPlanPriceCode)`
returns decimal-string `amountDueNow` and `recurringAmount`, `currency`, `kind`,
`effectiveAt` and `nextBillingAt`. Upgrades require `expectedAmountDueNow` on
`changePlan` / the Nest attempt request: Billing rejects a newly computed amount
above this accepted ceiling and freezes the actual authoritative charge.

The Nest adapter exposes authenticated `GET /payments/subscription/plan-change-quote`
with `targetPlanCode` and `targetPlanPriceCode` query parameters, and
`POST /payments/checkout-attempts/:id/confirm` after each PayPal approval return.
Only this POST invokes provider reconciliation and capture. GET attempt polling
never creates or captures a payment. Follow `planChange.action` and the refreshed
`checkoutUrl`: `approve_subscription` authorizes the recurring agreement,
`approve_payment` authorizes the one-time prorated order, and `none` has no
further approval. Activate access only from canonical license updates.

Publish the SDK release through the existing npm release workflow before pinning
consuming applications to that release; source changes do not update installed
`@hemia/payments` packages. Sandbox verification of both approval steps is required
before enabling the flow in production.
