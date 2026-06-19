# Billing Roadmap

## Estado actual

- Estado general: MVP backend de Billing completado en fases funcionales 01-15.
- Arquitectura actual: modulos feature-based directos bajo `apps/api/src/modules`.
- Agregador: `apps/api/src/modules/billing.module.ts`.
- Compartidos de dominio: `apps/api/src/modules/billing-shared/{entities,enums,constants,errors}`.
- Tests unitarios: `apps/api/test/unit`.

## Decisiones de arquitectura

- Billing ya no usa carpeta unica `apps/api/src/modules/billing`.
- Cada feature vive como modulo hermano directo:
  - `audit`
  - `catalog`
  - `checkout`
  - `entitlements`
  - `invoices`
  - `licenses`
  - `paypal`
  - `subscription-addons`
  - `subscriptions-management`
  - `webhooks`
- `billing-shared` concentra solo artefactos compartidos de dominio: entities, enums, constants y errors.
- Archivos `*.types.ts` viven en `types/` dentro del modulo que los consume.
- Specs unitarios viven fuera de `src`, centralizados en `apps/api/test/unit`.
- Rutas HTTP y nombres publicos de clases/endpoints se conservan; el cambio es organizacional.

## Fases completadas

- Fase 01 - Configuracion base del backend.
- Fase 02 - Modulo shared de billing.
- Fase 03 - Entidades base del MVP.
- Fase 04 - Catalogo de productos, planes y add-ons.
- Fase 05 - Cliente PayPal y configuracion de proveedor.
- Fase 06 - Checkout de suscripcion.
- Fase 07 - Webhooks PayPal e idempotencia.
- Fase 08 - Procesamiento de suscripciones y pagos.
- Fase 09 - Licencias y resolucion de acceso.
- Fase 10 - Auditoria comercial y referencia Legal.
- Fase 11 - Facturacion fiscal / CFDI.
- Fase 12 - Add-ons recurrentes.
- Fase 13 - Entitlements y limites consumibles por producto.
- Fase 14 - Gestion de suscripcion.
- Fase 15 - Seguridad, permisos y hardening.
- Fase 16 - Reorganizacion modular y centralizacion de tests.

## Pendientes tecnicos

- Generar migraciones manuales pendientes para cambios de schema acumulados.
- Ejecutar seeds de catalogo despues de migrar DB.
- Validar `test:e2e` con PostgreSQL accesible; hoy requiere DB real disponible.
- Integrar `IdentityClientPort` con `@hemia/auth/SsoClient`.
- Integrar proveedor real de CFDI/PAC.
- Probar manualmente webhooks PayPal Sandbox/Live.

## Validacion esperada

```bash
bun run --cwd apps/api build
bun run --cwd apps/api test
bun run --cwd apps/api test:e2e
```

`test:e2e` depende de DB configurada y accesible.
