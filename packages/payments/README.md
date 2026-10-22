# @hemia/payments

Server-side client for Hemia Billing. Console generates `PAYMENTS_CONNECTION` for the selected environment, backend and product. Load its JSON plus the backend's `HEMIA_CLIENT_SECRET` from your existing secret provider. This is the same backend credential used for other authorized Hemia services.

```ts
import { createPaymentsClient } from '@hemia/payments';

const payments = createPaymentsClient({
  ...JSON.parse(process.env.PAYMENTS_CONNECTION!),
  clientSecret: process.env.HEMIA_CLIENT_SECRET!,
});

const plans = await payments.catalog.listPlans();
const checkout = await payments.checkout.create({
  organizationId: authorizedSession.organizationId,
  userId: authorizedSession.userId,
  planCode: selectedPlan.code,
  planPriceCode: selectedPrice.code,
  // Optional: only when using Hemia Legal.
  // legalAcceptanceId: confirmedLegalAcceptance.id,
  idempotencyKey: persistedPurchaseAttempt.key,
});
// Send only checkout.checkoutUrl to your browser.
```

`checkout.status(checkoutId)` reads the caller-owned checkout. `licenses.resolve(organizationId)` reads the configured product's license; checkout redirects and approvals alone never grant access. Hemia Legal is optional. If your application manages its own documents, omit `legalAcceptanceId`; Billing does not call Legal or create Legal evidence. If supplied, the acceptance is validated before a new checkout is created.

Configuration: `issuer`, `tokenUrl`, `clientId`, `baseUrl` (Billing API prefix), `audience`, optional `resource`, `productCode`, optional `successUrl` and `cancelUrl`. Read operations need no return URLs; `checkout.create` requires both through configuration or its input and rejects missing/unsafe values locally before any request. `clientSecret` stays outside the generated configuration. Optional `allowHttpLoopback` works only outside production. Timeouts default to five seconds and are bounded to 30 seconds. Operation scopes and PayPal transport are internal. When a return URL is configured, per-attempt overrides may change its path/query within that configured origin. Without a configured URL, the input supplies it; Billing still checks every return origin against the client policy.

The package uses `@hemia/auth` ^1.1.0 for OAuth caching, concurrent requests and destination restrictions. Errors expose only `code`, optional HTTP `status` and bounded `retryAfterSeconds`. No provider bodies or secrets. There are no automatic POST retries: explicitly retry the same persisted request/key after an uncertain result. An existing `CHECKOUT_IN_PROGRESS` result can be retried after its delay.

Run `bun run test:payments` in Billing. Local development and package checks use `@hemia/auth@1.1.0` from npm. Rebuild and pack Payments after source changes before updating a consumer. The core import has no framework dependency. The optional NestJS module below adds PostgreSQL receipts and authenticated webhook handling; neither entry point has a webhook poller or payment provider credentials.


## NestJS + PostgreSQL

Install the package alongside NestJS 11, TypeORM (the existing host DataSource), `reflect-metadata` and `rxjs`. Importing `@hemia/payments` alone does not load these optional peers. Use the public `@hemia/payments/nestjs` entry point:

```ts
import { PaymentsModule } from '@hemia/payments/nestjs';

PaymentsModule.forRootAsync({
  imports: [ConfigModule, AuthModule], // your existing modules
  inject: [ConfigService, AuthService],
  useFactory: (config, auth) => ({
    connection: config.getOrThrow('PAYMENTS_CONNECTION'), // JSON string or object
    clientSecret: config.getOrThrow('HEMIA_CLIENT_SECRET'),
    authorize: (request, operation) => auth.authorizePayments(request, operation),
    // Optional: enable only when using Hemia Legal.
    // legal: { resolveContext: (input) => auth.resolveContractingContext(input) },
  }),
});
```

The module reuses the default `DataSource` exported by the host database module; it never initializes a database or runs a migration. Import your database module if it is not global. Named/multiple database hosts may supply `dataSource` explicitly. JSON parsing and startup validation are handled inside the SDK with sanitized configuration errors.

`ConfigModule`, `AuthModule`, `ConfigService` and `AuthService` above are the application's existing configuration/authentication services, not new SDK adapters. `authorizePayments` is an illustrative method name: connect your current authorization directly; no `ApplicationPaymentsContext` service is required.

The application callback authenticates its existing session, current membership, permissions and required MFA, then returns `{organizationId, subjectId, sessionId?, membershipId?}`. Operations are `plans.read`, `checkout.manage`, `license.read` and `legal.accept`. The module never accepts organization/user/product identity from a checkout body. Keep the application's existing CSRF/origin guard on user mutation routes. `returnUrls` is optional when the configured URLs already fit the frontend; overrides remain restricted to the configured origins.

Console's optional `connection.receiver` supplies `{audience,billingClientId,consoleClientId}`. The module derives JWKS and introspection URLs from Identity's issuer/token URL; `receiver` module options may override these endpoints explicitly. Catalog-only configuration requires no receiver. Machine endpoints fail closed until a receiver is configured. `SERVICE_AUTHENTICATED_METADATA` marks only service routes so a host CSRF/session guard can recognize them; the module's JWT signature, exact client/audience/scope and current introspection checks remain mandatory. Webhooks additionally require a fresh `x-billing-timestamp`.

Register `PaymentsSchema1792886400000` explicitly in the host's migration list, then run its normal migration command. Startup never creates tables or runs migrations. The migration owns `payments_checkout_attempts`, `payments_licenses` and the narrowly scoped `payments_apply_license` function. No foreign keys to application entities, shared organization tables or trial records are created. Public database privileges are revoked. A host using RLS adds its own policies/role grants in its explicit migration; `scopeTransaction(manager,{kind:'user'|'webhook',context?})` configures its existing transaction-local role and context. Authenticated webhook application calls the SECURITY DEFINER function; grant EXECUTE only to the intended runtime role and select its owner under the host's existing security policy. Do not grant client/browser database access.

Routes are relative to the application's global prefix:

| Route | Behavior |
| --- | --- |
| GET `/payments/plans` | Authorized catalog read. |
| POST `/payments/checkout-attempts` | `{idempotencyKey,planCode,planPriceCode,legalAcceptanceId?}`; persists before HTTP. |
| GET `/payments/checkout-attempts/:id` | Tenant-scoped receipt; repairs a missing status through a read-only Billing request. |
| POST `/payments/checkout-attempts/:id/retry` | Explicitly repeats the same frozen request/key. |
| GET `/payments/license` | Local license projection with 24-hour freshness and expiry checks. |
| GET/POST `/payments/webhooks/license` | Authenticated receiver probe / monotonic license update. |
| GET `/payments/integration-status` | Console-authenticated verification using the installed credential. |
| GET `/payments/ready` | Schema readiness; no migration or upstream mutation. |
| POST `/payments/legal/prepare`, `/accept`, `/context` | Optional Legal integration; 404 when disabled. |

A checkout response contains `attemptId`, `status`, optional checkout references and `statusFresh`. Pending/processing replies use 202 and Retry-After; a terminal rejection uses 422. A timeout preserves the receipt for explicit retry after restart. Concurrent callers reuse the same frozen payload and Billing idempotency/fencing; this module has no scheduler, background purchase retry or second payment engine. Billing owns provider execution. An old/duplicate webhook cannot refresh license validity. A webhook received before the checkout response is repaired by GET status without making another purchase.

Legal is optional for this module. Enable it with `{ resolveContext }`; the SDK reads endpoints and client IDs from `connection.legal`. An explicitly enabled but incomplete Legal configuration fails at startup. Advanced hosts may override these endpoints explicitly. Pass this callback as the `legal` option; the application callback checks current session/MFA/membership/contract permissions. The package handles prepare/accept HTTP, evidence validation and authenticated callbacks. Without this option, omit `legalAcceptanceId` for payments only. You may also provide a real Hemia Legal acceptance obtained separately; Billing validates every supplied acceptance. Missing evidence is never replaced by a fabricated acceptance. Trials and application-specific access rules remain in the host. `PaymentsService.getLicense(context)` returns `LicenseAccess` for composition with those rules.

Verification in this workspace: `bun run build`, `bun run typecheck`, `bun run test`, and `bun run test:nest`. The independent-host regression suite lives outside this package at `test/payments/integration/atlas`; run `bash test/payments/integration/atlas/verify.sh` from Billing after building the SDK. It installs the tarball and tests both Legal modes against disposable PostgreSQL.

## Console: payments only or optional Hemia Legal

Billing and Legal already provide their own setup: create/activate your product, publish a plan version with an active price and its provider mapping in Billing. Only if using Hemia Legal, create the application and publish its documents and acceptance rules there. These are commercial/document setup, not product SDK code.

In Console select the existing system/backend client, payments functions, product, authorized organizations and return URLs. Provide the backend base URL including its global prefix (for example `https://api.atlas.example/api`). Console registers the standard SDK receiver, backend check and optional Legal context routes. The audience comes from the backend client's configured audience; it is never guessed. Custom services remain available for hosts with custom routing. Copy `PAYMENTS_CONNECTION` and keep the existing backend secret separately.

For Hemia Legal additionally select its acceptance collector, application, published documents and actual source identity namespace. The namespace is distinct from the OAuth issuer and must match your product's existing identity contract. Console configures the context route automatically for the standard backend base URL. Add only `legal: { resolveContext }` in the module; omit the property for payments only. `authorize` remains required in both modes. No product frontend changes are part of this SDK configuration.

Register `PaymentsSchema1792886400000` in your existing TypeORM migration list and run the application's migration command explicitly before deployment; never run it on startup. Keep CSRF protection for user mutations. The frontend lists plans, creates an attempt with a stable UUID idempotency key and chosen plan/price, handles pending/retry/error states, redirects when ready, and checks `/payments/license` to grant access. A success redirect alone is not proof of payment. With Hemia Legal selected, insert prepare/present/accept before creating the attempt.

## Releases

Public releases use Changesets and a reviewed version PR. See [release operations](https://github.com/hemia-labs/billing/blob/main/docs/payments-release.md). Auth 1.1.0 and Payments 0.2.0 are available on npm; consumers install published versions without vendor tarballs.
