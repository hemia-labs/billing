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
```

## Variables de entorno

Copia `.env.example` a `.env.local` para desarrollo o a `.env.production` para
produccion y completa los valores. La aplicacion y el DataSource de la CLI cargan
solo `.env.production` cuando `NODE_ENV=production`; en los demas entornos cargan
`.env.local`. Define `NODE_ENV` antes de ejecutar el proceso; `start:prod` ya lo
establece. Las variables inyectadas al proceso tienen prioridad sobre el archivo.
Vault permanece deshabilitado salvo que se defina `SECRETS_ENABLED=true`.

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
HEMIA_LEGAL_TOKEN_URL=
HEMIA_LEGAL_CLIENT_ID=billing-legal-service
HEMIA_LEGAL_CLIENT_SECRET=

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
  `client_id` verificado debe tener una política en `billing_service_clients`, administrada desde Console.
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
Registra el consumidor desde Console: selecciona su cliente Identity, productos,
organizaciones y retornos. Billing consulta `billing_service_clients` en cada
autorización; no existe un fallback de configuración por entorno. Los permisos
OAuth efectivos deben incluir el destino Billing. Los retornos solo son
obligatorios para clientes habilitados con permiso de crear checkout.
Una conexión de solo catálogo puede guardar `organizationScope: "organizations"`
y `organizationIds: []`, sin retornos: consulta los productos autorizados y no
accede a ninguna organización. Los permisos efectivos para crear/consultar
checkout o consultar licencias requieren organizaciones concretas o el alcance
global explícito por producto.
Un cliente desconocido o deshabilitado recibe `403`. El alcance por organización
es explícito y el formulario exige productos concretos.

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

El build emite la API en `dist/src/`: `bun run start:prod` inicia `dist/src/main.js` y el DataSource de producción descubre las migraciones en `dist/src/database/migrations/*.js`. Las migraciones siguen ejecutándose explícitamente, nunca durante el arranque.

`synchronize` está en `false`: todo cambio de schema requiere migración.

## Tests y build

```bash
bun run --cwd apps/api build
bun run --cwd apps/api test      # unit specs en test/api/unit
bun run --cwd apps/api test:authorization:docker # PostgreSQL desechable; requiere Docker
```

### Consumidores administrables desde consola

Console administra conexiones con un token de servicio para Billing y los scopes
`billing.integrations.read` / `billing.integrations.manage`. Cada llamada incluye
`x-hemia-actor-subject` del operador autorizado por Console; Billing registra
operador y cliente técnico. La consola propia de Billing mantiene su sesión
humana y permisos existentes.

Rutas bajo `/api/v1/billing/integrations/admin`:

- `GET /options`: productos, organizaciones conocidas, clientes Identity, políticas y receptores.
- `PUT /clients/:clientId`: política persistida con permisos Identity comprobados.
- `PUT /receivers/:productCode`: `{url,audience,resource,enabled}`; requiere destino
  autorizado del cliente Billing para `billing.webhooks.deliver`.
- `POST /receivers/:productCode/check`: comprobación GET autenticada y sin efectos
  comerciales del receptor registrado.

Aplicar explícitamente `1792627200000-generic-license-connections.ts` junto con
los consumidores actualizados. La cola identifica organización y producto;
los receptores se registran por producto. No hay variables de callback fijas,
aliases ni ejecución simultánea del contrato anterior. Los pendientes previos
se conservan y esperan a que se registre su receptor. No se aplican migraciones
en el arranque.

### Contexto vigente de compradores externos

Todos los productos usan el contrato externo v2 de Legal. La referencia de
aceptación determina sistema/aplicación/documentos en Legal; Billing envía
organización, usuario, producto y aceptación y verifica el hash de la evidencia.
No existe un mapa por producto ni una rama especial para Balanz.

El cliente `billing-legal-service` necesita audiencia `legal-api`, scope
`legal.integration.acceptances.validate` y rol `validator` en la integración
externa de Legal. Legal consulta el contexto vigente del sistema consumidor con propósito
`checkout_validation`: membresía activa, organización habilitada y permiso para
contratar. La URL y autorización de esa consulta se configuran desde Console;
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

## Organización de pruebas y módulos

Todas las pruebas, configuraciones y runners viven en `../../test/`: Jest usa `test/api/unit`, Fevex usa Bun y las integraciones desechables viven en `test/api/integration`. Ejecutar `bun run test` desde la raíz Billing incluye API y frontend. Ver [guía de pruebas](../../test/README.md).

Auth agrupa sesión y Redis; Integrations separa service-clients y oauth-clients; los módulos con varios controladores usan `controllers/`. Webhooks agrupa sus workers y servicios PayPal en `paypal/`; Event Bus mantiene transporte y contratos juntos. No cambian endpoints ni contratos.

## Proveedor de pagos

Billing selecciona el único proveedor activo de `provider_prices` asociado al precio publicado solicitado. Sin configuración devuelve `404`; con varios proveedores activos devuelve `409`. Un proveedor sin adaptador devuelve `422` antes de realizar una operación financiera. El SDK y los productos consumidores no eligen proveedor ni configuran credenciales de la pasarela.

La selección se conserva en el intento durable. Los reintentos reutilizan el proveedor y la clave originales; los cambios y cancelaciones de una suscripción usan el proveedor de ese contrato. No se cambia de proveedor al editar el catálogo ni se usa PayPal como alternativa ante una configuración inválida.

PayPal es el adaptador implementado. Traduce sus estados, valida sus URLs de aprobación y declara sus ventanas de idempotencia. Fuera de una ventana de creación incierta, Billing requiere conciliación y no crea otra compra automáticamente. Otros proveedores necesitan su propio adaptador y recepción de eventos antes de habilitarse. Este cambio no requiere migraciones nuevas.
