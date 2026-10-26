# web

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
