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
BILLING_SERVICE_CLIENTS={}
AUTH_LEGACY_API_KEY_ENABLED=false

PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_API_BASE_URL=

HEMIA_LEGAL_BASE_URL=
HEMIA_LEGAL_TOKEN_URL=
HEMIA_LEGAL_CLIENT_ID=billing-legal-service
HEMIA_LEGAL_CLIENT_SECRET=
HEMIA_LEGAL_PRODUCTS={}

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
- El JWT de servicio debe incluir `grant_type: client_credentials`, `client_id`
  y `sub` no vacíos, `iss` y `aud` coincidentes con la configuración, y `iat` y
  `exp` numéricos. La vigencia máxima es de 600 segundos. No se infiere que un
  token sea de servicio por tener `client_id` o por carecer de `email`.
- `AUTH_AUDIENCE` y un issuer (`AUTH_REQUIRED_ISSUER` o `AUTH_ISSUER_URL`) son
  obligatorios para validar Bearer en cualquier ambiente. Token inválido o de
  usuario devuelve `401`; servicio válido sin el scope de la ruta devuelve `403`.
- `GET /billing/catalog/products` es el catálogo mínimo para integraciones y
  requiere `billing.integration.catalog.read`. Los `POST/PATCH /billing/*`
  de catálogo conservan compatibilidad machine-only con `billing.catalog.manage`.
- La futura consola usa sólo Bearer SSO de usuario mediante
  `BillingConsoleAuthGuard`; rechaza `client_credentials` y API keys. Sus rutas
  de catálogo son `billing/console/catalog/*`, con `billing.catalog.read` para
  consultas y `billing.catalog.manage` para escritura.
- Las integraciones no aceptan `x-billing-internal-api-key`, cookies ni sesiones
  SSO como sustituto del Bearer de servicio.
- Guards OIDC/permisos disponibles: `SsoBearerGuard`, `BillingInternalAuthGuard`, `BillingConsoleAuthGuard`, `PermissionsGuard` y `@Permissions(...)`.
- Token esperado: `Authorization: Bearer <access_token>` firmado RS256 y verificable por `AUTH_JWKS_URI`.
- Identity debe emitir JWT de servicio con este contrato antes de desplegar esta
  validación. Los tokens opacos no son válidos para estas rutas; el sistema debe
  solicitar un nuevo access token a Identity y conservarlo hasta su expiración.
- Scopes soportan exacto, `billing.*` y `*.*`; pueden venir como `scope` string OAuth o `scopes` array.
- Los scopes no otorgan acceso a cualquier producto u organización: cada
  `client_id` verificado debe registrarse en `BILLING_SERVICE_CLIENTS`.
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

## Autorización de sistemas externos

Identity verifica la identidad del sistema y sus scopes. Billing autoriza los
recursos usando el emisor verificado y `client_id`; no requiere sesión SSO.
Configura `BILLING_SERVICE_CLIENTS` como JSON (estos IDs son ejemplos y deben
reemplazarse por los clientes reales de Identity):

```json
{
  "medsync-service": {
    "products": ["medsync"],
    "organizationScope": "all_for_allowed_products",
    "allowedReturnOrigins": ["https://medsync.example"]
  },
  "restricted-service": {
    "products": ["medsync"],
    "organizationScope": "organizations",
    "organizationIds": ["00000000-0000-4000-8000-000000000001"],
    "allowedReturnOrigins": ["https://restricted.example"]
  }
}
```

En `.env`, guarda el JSON en una sola línea. La configuración se valida al
arrancar; cambiarla requiere reiniciar Billing. `{}` rechaza todos los clientes.
Un cliente desconocido o con `enabled: false` recibe `403`, aunque tenga scopes
amplios. El alcance por organización siempre debe ser explícito.
`products: ["*"]` permite todos los productos; usarlo junto con
`organizationScope: "all_for_allowed_products"` otorga acceso global explícito.

Crear checkout o consultar licencia fuera de los productos/organizaciones
permitidos devuelve `403`. Consultar o modificar un recurso existente ajeno
devuelve `404`, comprobando el producto y organización almacenados. El catálogo
protegido y las facturas se filtran en la consulta a la base de datos.
Las mismas restricciones se aplican a las rutas de integración y a las rutas
compatibles de checkout, suscripciones, add-ons, catálogo interno y facturas.

Cada checkout guarda `createdByIssuer` y `createdByClientId` en su metadata;
Billing obtiene esos valores del token verificado. Por defecto sólo el cliente
creador puede consultar o verificar ese checkout. `allowSharedCheckouts: true`
autoriza explícitamente compartir consultas/verificaciones dentro de los
productos y organizaciones permitidos; no amplía ese alcance ni permite
recuperar el enlace de otro cliente mediante una clave de idempotencia.
Los checkouts históricos sin creador no se asignan automáticamente: su consulta
requiere el permiso explícito de acceso compartido y reintentar una clave
histórica sin creador devuelve `409` para reconciliar el checkout original.
`enabled` vale `true` y `allowSharedCheckouts` vale `false` si se omiten en una
política registrada. Guardar el creador usa la metadata JSONB existente y no
requiere migración.

### URLs de retorno del checkout

Cada cliente que crea enlaces configura `allowedReturnOrigins` con sus orígenes
reales. Los dominios `.example` de arriba son sólo ejemplos. Omitir la lista o
usar `[]` rechaza la creación/reanudación de checkout con `403`; no restringe
las otras operaciones autorizadas del servicio.

`successUrl` y `cancelUrl` necesitan un protocolo explícito y deben coincidir
con un origen registrado: protocolo, host y puerto. Se permiten rutas y query
strings dentro de ese origen. No se admiten credenciales ni comodines;
`https://medsync.example` no autoriza subdominios ni puertos distintos.
Billing normaliza los orígenes configurados y rechaza una configuración con
rutas, query strings, fragmentos o protocolos no permitidos al arrancar.

En producción sólo se acepta HTTPS. HTTP requiere `NODE_ENV=development` o
`test`, un host exactamente `localhost`, `127.0.0.1` o `[::1]` y ese origen con
su puerto registrado explícitamente. Por ejemplo: `http://localhost:5175`.
La validación ocurre en el servicio compartido antes de Legal o PayPal y se
repite sobre las URLs almacenadas antes de recuperar o devolver un enlace.
Una URL inválida devuelve `400`; un origen fuera de la lista devuelve `403`.
Esta lista es independiente de `CORS_ORIGINS`.

## Idempotencia del checkout

`POST /api/v1/billing/integrations/v1/checkout/sessions` y el endpoint interno
`POST /api/v1/billing/checkout/sessions` requieren `idempotencyKey` en el body:
una clave de 1 a 120 caracteres sin espacios (por ejemplo, un UUID).
`POST /api/v1/billing/subscriptions/:id/change-plan` también requiere la clave
y la transmite al mismo servicio de checkout.

El consumidor genera y conserva una clave por intención de compra. Los
reintentos deben enviar la misma clave y los mismos datos: Billing reutiliza
`checkoutId`, `subscriptionId` y `checkoutUrl`, incluso con peticiones
concurrentes. Reutilizar una clave con otro body devuelve `409`.

La clave y la huella del request se guardan por emisor, cliente y organización
en la columna `checkout_sessions.metadata` existente. El índice único
`UQ_checkout_sessions_service_idempotency` cubre organización, emisor, cliente
y clave, incluyendo checkouts eliminados lógicamente: una clave usada no se
libera al borrar el checkout. La búsqueda por namespace usa ese índice y los
checkouts históricos sin creador se consultan por separado para reconciliación.
Legal se valida antes de abrir la transacción. La creación vuelve a comprobar
la clave bajo un bloqueo breve por emisor, cliente, organización y clave, y reserva el checkout mediante
`attemptId` y `leaseUntil` en su metadata. La reserva dura 60 segundos y usa el
reloj de PostgreSQL. PayPal se consulta fuera de la transacción; el resultado
se guarda en otra transacción breve sólo si el intento sigue vigente.
Los estados/periodos actuales de la suscripción y la metadata de otros procesos
se conservan al guardar. El UUID persistido del checkout se envía como `PayPal-Request-Id`.
Si se pierde la respuesta o falla el guardado posterior, se recupera la misma
suscripción con ese ID y el payload original. Tras la ventana de 72 horas de
PayPal, un intento sin resultado conocido devuelve `409` y requiere
reconciliación; no se debe cambiar la clave para eludir un resultado incierto.

Mientras exista una reserva vigente, repetir la petición devuelve `409` con
`code: "CHECKOUT_IN_PROGRESS"`, `checkoutId`, `retryAfterSeconds` y la cabecera
`Retry-After` en segundos. El consumidor espera ese intervalo y vuelve a enviar
la misma clave y el mismo body; este código es distinto de un conflicto de clave.
Un error de red libera la reserva al guardar el fallo. Si el proceso cae o falla
el commit posterior a PayPal, la reserva vence y la siguiente petición puede
retomar el checkout original. Una respuesta de un intento reemplazado no
sobrescribe el intento nuevo: devuelve el resultado ya terminado o el mismo
error transitorio de progreso. No se incorpora un worker de reintentos automáticos.

Antes de desplegar esta versión, aplicar la migración
`1790899200000-checkout-idempotency-indexes.ts` con `bun run migration:run`.
La migración también garantiza un único cliente activo por organización y
proveedor. La creación usa `INSERT ... ON CONFLICT DO NOTHING` y recupera ese
cliente, evitando duplicados entre claves concurrentes sin bloquear toda la
organización. Los clientes eliminados lógicamente pueden reemplazarse; sus
suscripciones conservan la referencia original.
La migración comprueba duplicados y falla si los encuentra. Reconciliar esos
registros y sus referencias antes de volver a ejecutarla; no se fusionan ni
eliminan datos automáticamente. Aplicarla con los procesos que escriben
checkout detenidos, antes de habilitar la versión con bloqueos por intento.

## Renovaciones de PayPal

Al recibir `PAYMENT.SALE.COMPLETED`, Billing consulta la suscripción actual en
PayPal antes de registrar el pago y recalcular la licencia. Usa la referencia
de suscripción del evento (`billing_agreement_id`, `subscription_id` o
`supplementary_data.related_ids.subscription_id`), conservando el ID de la venta
para el registro del pago.

El periodo se actualiza con `billing_info.last_payment.time` y
`billing_info.next_billing_time`, según el
[contrato de PayPal](https://developer.paypal.com/api/subscriptions/v1/subscriptions-get).
La licencia usa el nuevo vencimiento y el estado confirmado de la suscripción.
Un pago antiguo no reactiva una suscripción cancelada, expirada o suspendida.
Si PayPal falla o una renovación activa no trae una próxima fecha de cobro
válida, el procesamiento falla sin conceder acceso indefinido.

Los eventos `ACTIVATED`, `PAYMENT.FAILED`, `SUSPENDED`, `CANCELLED` y `EXPIRED`
también recalculan la licencia desde el estado actual consultado en PayPal.
Así, una activación atrasada no concede acceso a una suscripción cancelada,
y una cancelación atrasada no revoca una suscripción que ya está activa.
Los pagos fallidos solo afectan a suscripciones confirmadas como `ACTIVE`;
no reemplazan los estados terminales. Si la consulta no confirma un estado
reconocido, el procesamiento falla antes de modificar la suscripción o licencia.

## Recuperación de webhooks de PayPal

`POST /api/v1/billing/webhooks/paypal` devuelve `503` si falla el procesamiento
o todavía no existe la suscripción o el pago local que necesita el evento.
El intento revierte sus cambios de negocio mediante un savepoint y conserva
el webhook como `failed`, con su error, antes de responder. Un nuevo envío
reutiliza el registro por `providerEventId`; los eventos ya procesados y los
tipos no soportados se reconocen con `200`, sin volver a aplicar sus efectos.

La recuperación automática usa los
[reintentos de entrega de PayPal](https://developer.paypal.com/api/rest/webhooks):
hasta 25 intentos durante tres días mientras no reciba una respuesta 2xx.
Una firma inválida devuelve `403` y no permite procesar el evento ni reemplazar
un payload que ya fue verificado. El reintento manual conserva las mismas
garantías de rollback, autorización y límite de intentos.

Los eventos reconocidos con `200` antes de este cambio requieren reenvío desde
PayPal o reintento manual; PayPal ya había confirmado su entrega. Los antiguos
`ignored` por suscripción o pago no encontrado ahora admiten esos reintentos.
Si se agota la ventana automática de PayPal, también se requiere reenvío o
reintento manual. Este cambio usa las columnas existentes y no requiere migración.

## Arranque

```bash
bun install
bun run --cwd apps/api start:dev   # watch mode
```

Con la configuración default, el endpoint raíz queda bajo `/api/v1/`.
El servidor requiere variables `DB_*` válidas para inicializar TypeORM.

## Migraciones

El checkout usa `evidence` y `valid` de Legal. La evidencia documental se guarda
en `metadata.legalEvidence` de checkout, suscripción y auditoría; las versiones
fijas de términos, privacidad y reembolsos ya no se usan.

Antes de desplegar este cambio, aplicar la migración
`1791244800001-remove-fixed-legal-versions`, que retira `terms_version`,
`privacy_version` y `refund_policy_version` de `checkout_sessions`,
`subscriptions` y `audit_logs`. La migración bloquea las tablas y aborta si
alguna columna contiene valores distintos de NULL, vacío o espacios. Si hay
datos históricos, preservarlos antes de eliminar las columnas: no permiten
reconstruir por sí solos la evidencia completa de Legal. Las columnas
obligatorias del esquema anterior impiden crear nuevos checkouts con el código
actualizado.

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

### Consumidores administrables desde consola

Billing → Integraciones permite registrar y editar consumidores con los permisos
`billing.integrations.read` y `billing.integrations.manage` del rol global
`billing.catalog_manager`. El registro persistido tiene prioridad sobre
`BILLING_SERVICE_CLIENTS`, incluso al deshabilitar un consumidor, y se consulta
sin caché para aplicar cambios sin reiniciar. Las credenciales OAuth y scopes
continúan en Identity. Aplicar la migración
`src/database/migrations/1791244800000-billing-service-clients.ts` antes de
desplegar.

Esquema a incluir en la migración TypeORM para
`src/common/entities/billing-service-client.entity.ts`:

- Tabla `billing_service_clients`.
- `id`: UUID generado, llave primaria.
- `client_id`: varchar(120) obligatorio; índice único
  `IDX_billing_service_clients_client_id`.
- `policy`: jsonb obligatorio.
- `created_at` y `updated_at`: timestamptz obligatorios, valor inicial `now()`.

La migración está generada y pendiente de ejecución. Aplicarla antes de desplegar el backend:
la consulta del registro falla cerrada si no está disponible la tabla. Los
consumidores del entorno no se importan durante GET ni al arrancar; al editarlos
se crea un registro persistido que tiene prioridad, incluso al deshabilitarlo.

### Contexto vigente de compradores externos

Para `balanz_cfdi`, Billing exige el contrato externo v2 de Legal: el mapeo en
`HEMIA_LEGAL_PRODUCTS` debe incluir `issuerId`, `applicationId`, `identitySourceId`
y `identityIssuer: "urn:hemia:balanz"`. Un mapeo interno v1 o un emisor de identidad
distinto se rechaza antes de llamar a Legal o PayPal. Los UUID corresponden a la
integración existente en Legal; no se registran organizaciones ni membresías en
Billing para comprobar el contexto.

El cliente `billing-legal-service` necesita audiencia `legal-api`, scope
`legal.integration.acceptances.validate` y rol `validator` en la integración
externa de Legal. Legal consulta el contexto vigente de Balanz con propósito
`checkout_validation`: membresía activa, organización habilitada y permiso para
contratar. La URL y autorización de esa consulta se configuran en Legal y Balanz;
Billing usa el contrato de validación existente.

Una compra nueva valida Legal antes de crear el checkout. Si un intento anterior
quedó sin resultado de PayPal, Billing vuelve a validar el usuario, organización,
producto y aceptación originales después de reservar el reintento y antes de
contactar a PayPal. Esa consulta ocurre fuera de la transacción. Si falla, Billing
guarda el fallo, libera la reserva y conserva la clave y los IDs originales para
reintentar o reconciliar; no crea otra compra ni cambia la aceptación contratada.

Legal `403` se devuelve como `403`; Legal `400` se devuelve como `400`. Un fallo
de red, autenticación técnica, respuesta inválida o indisponibilidad de Legal
bloquea la compra. Las respuestas ya persistidas se reutilizan sin otra llamada
a Legal/PayPal, y los intentos con reserva vigente siguen devolviendo
`CHECKOUT_IN_PROGRESS` sin volver a consultar Legal. Esta comprobación no cancela
ni revoca una suscripción o enlace que ya exista en PayPal. No requiere migración.
