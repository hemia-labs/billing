# api

## 1.4.1

### Patch Changes

- 867977c: Process verified PayPal webhooks promptly, shorten checkout response waits, and log the duration of external checkout calls.

## 1.4.0

### Minor Changes

- 550724f: Expose Payments connection discovery and resolution v2 with the independent `billing.integration.connections.read` machine permission. Resolve only the authenticated client's published snapshot for an active authorized product. Catalog, checkout and license operations retain their existing permissions. Keep the published v1 contract available for Payments 0.11.0 clients. No Billing database migration is required.

## 1.3.0

### Minor Changes

- 4ece12c: Add public Payments connection discovery and authenticated snapshot resolution for the verified OAuth machine client. Reuse `billing.integration.catalog.read`, enforce the current client policy and active authorized product, and return only versioned configuration without secrets.

  Persist Console-published connections in the existing service-client policy, preserving omitted snapshots and merging updates under the existing transaction lock. No database migration or seed is required. Discovery derives its public Billing origin from the configured SSO redirect URI rather than request headers.

## 1.2.0

### Minor Changes

- 53b91f9: Add subscription renewal resumption and future renewal plan changes through durable, idempotent payment attempts. Expose pending renewal approval and checkout state, preserve paid access until the current period ends, and reconcile PayPal subscription payments, cancellations and refunds with the effective billing period.

  Recover pending checkout attempts without duplicating provider subscriptions, exclude abandoned checkouts from the current subscription, and retain the initiating organization and client when resuming approval.

## 1.1.0

### Minor Changes

- 78364d0: Add an opt-in authenticated authorization mode for Console while preserving signed sessions and organization isolation. Scope service-client policy management to the selected organization and isolate cached contexts by authorization mode.

## 1.0.4

### Patch Changes

- 8400a24: Use whole-second timestamps required by the PayPal notification history API and report safe recovery failure reasons.

## 1.0.3

### Patch Changes

- 0f0ef4a: Recover missing PayPal refund webhook deliveries for known Billing payments using signed redelivery from the provider history.

## 1.0.2

### Patch Changes

- b9e4651: Fix Billing publication when a newly created draft is not visible through the release-by-tag endpoint. Keep the returned release ID and locate pending drafts through the authenticated paginated release listing, without replacing images or existing assets.

## 1.0.1

### Patch Changes

- 01cc47b: Expose an authenticated, read-only Billing integration compatibility contract and deployed application version for consumer deployment preflight checks.

## 1.0.0

### Major Changes

- f95840a: Primera release de Billing con CI, imagenes privadas, tags billing-vX.Y.Z, notas de Changesets y despliegue automatico con verificacion de migraciones.

  Permite arrancar en produccion con facturacion fiscal explicitamente deshabilitada mediante BILLING_FISCAL_PROVIDER=disabled; rechaza emision y cancelacion antes de reservar operaciones y nunca simula resultados fiscales.
