# API (NestJS)

Backend del monorepo `nextjs-nestjs`. Plantilla NestJS + TypeORM + PostgreSQL.
La base de datos está configurada desde el arranque mediante variables de entorno.

## Stack

- **NestJS 11** — framework HTTP (módulos, controllers, services).
- **TypeORM** — ORM + migraciones contra PostgreSQL.
- **PostgreSQL** — base de datos (timezone `America/Mexico_City`).
- **@nestjs/config** — configuración tipada por namespace (`registerAs`).
- **class-validator / class-transformer** — validación de DTOs vía `ValidationPipe` global.
- **TypeScript**, **Jest** (tests), **ESLint + Prettier**.
- Gestor de paquetes: **bun**.

## Estructura

```
apps/api/
  data-source.ts                 # DataSource para el CLI de migraciones
  src/
    main.ts                      # bootstrap: ValidationPipe global + CORS, prefix api/v1, escucha PORT
    app.module.ts                # módulo raíz con ConfigModule global + DatabaseModule
    config/
      app.config.ts              # config namespaced 'app' (port, prefix, CORS)
      database.config.ts         # config namespaced 'database' (registerAs)
      env.validation.ts          # schema Joi para variables de entorno
    database/
      database.module.ts         # TypeOrmModule.forRootAsync, synchronize: false
      migrations/                # migraciones TypeORM
    modules/
      billing.module.ts          # agregador de módulos billing
      billing-shared/            # entities, enums, constants y errores compartidos
      audit/
      catalog/
      checkout/
      entitlements/
      invoices/
      licenses/
      paypal/
      subscription-addons/
      subscriptions-management/
      webhooks/
      identity/
  test/
    unit/                        # specs unitarios centralizados
    app.e2e-spec.ts              # e2e
```

## Variables de entorno

Copia `.env.example` a `.env` y completa los valores:

```
NODE_ENV=development
PORT=3015
APP_GLOBAL_PREFIX=api/v1
CORS_ORIGINS=http://localhost:5175,http://localhost:3015
BILLING_INTERNAL_API_KEY=
AUTH_ISSUER_URL=
AUTH_JWKS_URI=
AUTH_AUDIENCE=
AUTH_REQUIRED_ISSUER=
AUTH_LEGACY_API_KEY_ENABLED=false

PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_API_BASE_URL=

HEMIA_LEGAL_BASE_URL=
HEMIA_LEGAL_API_KEY=

DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=
DB_PASSWORD=
DB_DATABASE=
DB_LOGGING=false
```

`PORT` default `3015`. `APP_GLOBAL_PREFIX` default `api/v1`.

## Seguridad

- Endpoints publicos: `GET /billing/catalog/plans` y `GET /billing/catalog/addons`.
- Webhook publico: `POST /billing/webhooks/paypal`; no usa sesion, JWT ni API key, depende de la verificacion de firma PayPal.
- Integraciones de producto usan sólo Bearer emitido por Identity con grant
  `client_credentials` y scopes de billing; los Bearer de usuario se rechazan.
- `GET /billing/catalog/products` es el catálogo mínimo para integraciones y
  requiere `billing.integration.catalog.read`. Los `POST/PATCH /billing/*`
  de catálogo conservan compatibilidad machine-only con `billing.catalog.manage`.
- La futura consola usa sólo Bearer SSO de usuario mediante
  `BillingConsoleAuthGuard`; rechaza `client_credentials` y API keys. Sus rutas
  de catálogo son `billing/console/catalog/*`, con `billing.catalog.read` para
  consultas y `billing.catalog.manage` para escritura.
- `x-billing-internal-api-key` queda como compatibilidad legacy solo si `AUTH_LEGACY_API_KEY_ENABLED=true`; no se permite en production.
- Guards OIDC/permisos disponibles: `SsoBearerGuard`, `BillingInternalAuthGuard`, `BillingConsoleAuthGuard`, `PermissionsGuard` y `@Permissions(...)`.
- Token esperado: `Authorization: Bearer <access_token>` firmado RS256 y verificable por `AUTH_JWKS_URI`.
- Scopes soportan exacto, `billing.*` y `*.*`; pueden venir como `scope` string OAuth o `scopes` array.
- Scopes de consola a registrar/asignar en Identity: `billing.dashboard.read`,
  `billing.catalog.read`, `billing.catalog.manage`, `billing.subscriptions.read`,
  `billing.subscriptions.manage`, `billing.licenses.read`, `billing.addons.read`,
  `billing.addons.manage`, `billing.invoices.read`, `billing.invoices.manage`,
  `billing.webhooks.read`, `billing.webhooks.retry` y `billing.audit.read`.
- Los responses de consola futuros no expondrán secrets, payloads/headers de
  PayPal, metadata no saneada, referencias legales completas ni URLs de
  aprobación. La URL de aprobación sólo se devuelve al crear un checkout de
  integración; el endpoint de estado no la repite.
- Los listados de catálogo de consola usan `page` y `limit` (máximo 100), con
  filtros de producto, estado, proveedor, moneda e intervalo donde aplica.
- `@hemia/auth` no esta instalado en esta fase. `IdentityClientPort` queda listo para una futura implementacion con `@hemia/auth/SsoClient` contra `/external/*`.
- En `production`, usa HTTPS para webhooks, `CORS_ORIGINS` explicito, OIDC/JWKS completo y PayPal live sin URL sandbox.

## Arranque

```bash
bun install
bun run --cwd apps/api start:dev   # watch mode
```

Con la configuración default, el endpoint raíz queda bajo `/api/v1/`.
El servidor requiere variables `DB_*` válidas para inicializar TypeORM.

## Migraciones

```bash
bun run --cwd apps/api migration:create src/database/migrations/<Nombre>
bun run --cwd apps/api migration:generate
bun run --cwd apps/api migration:run
bun run --cwd apps/api migration:revert
```

`migration:generate` crea `src/database/migrations/<timestamp>-migration.ts`.

`synchronize` está en `false`: todo cambio de schema requiere migración.

## Tests y build

```bash
bun run --cwd apps/api build
bun run --cwd apps/api test      # unit specs en apps/api/test/unit
bun run --cwd apps/api test:e2e
```
