# Conexiones PayPal por producto

## Administración desde Integraciones

La configuración comienza en **Integraciones → Proveedores de pago** (`/integrations/payments`), donde sólo se muestra el mosaico de proveedores. La card de PayPal abre su pantalla propia en `/integrations/payments/paypal`. Esa pantalla lista las conexiones guardadas por producto, tanto vigentes como borradores; los productos que sólo heredan la configuración global no se presentan como conexiones creadas. Los errores de consulta siguen visibles para no confundir una consulta fallida con ausencia de conexión.

**Crear conexión** abre un panel lateral con el selector **Producto asociado**. **Editar** o **Ver** abre el mismo panel con el producto de la fila preseleccionado. Cerrar el panel vuelve a la lista de PayPal. Los enlaces con `product_id` abren directamente ese producto en la ruta nueva y los enlaces anteriores bajo `/integrations/payments` se redirigen de forma interna. El breadcrumb del navbar mantiene la jerarquía Integraciones → Proveedores de pago → PayPal.

Cerrar el panel o cambiar de producto desmonta el formulario y descarta sus secretos en memoria. El webhook y la activación se completan después de guardar el borrador; la ayuda complementaria queda desplegable. Las credenciales históricas siguen disponibles desde el panel. El detalle del producto muestra únicamente un resumen de proveedor, tipo de cobro y estado, con enlace a su integración. No muestra campos de credenciales ni permite modificarlas.

La pantalla conserva los permisos de los endpoints: `billing.catalog.read` para consultar y `billing.catalog.manage` para guardar o rotar credenciales. Mover la configuración de menú no amplía permisos de otras integraciones. La separación entre borrador y conexión vigente requiere el cambio de esquema manual descrito más abajo.

Cada producto tiene como máximo una conexión PayPal vigente, un borrador independiente y varias conexiones históricas para sus contratos. Guardar un borrador no modifica la conexión vigente, su estado, sus credenciales ni la configuración global heredada; sólo activar el borrador puede sustituirla. Cada precio requiere exactamente un proveedor activo; varios se rechazan con `409`. El catálogo declara otros proveedores, pero actualmente sólo el adaptador PayPal está implementado. No hay un modelo independiente para elegir tarjeta, wallet u otros métodos de financiación: el resumen describe suscripciones recurrentes y el proveedor asociado. La configuración global heredada no acredita por sí sola disponibilidad de credenciales, y una conexión habilitada no garantiza que sus precios estén listos para checkout.


La consulta GET y el guardado PUT usan `/api/v1/billing/console/catalog/products/:id/paypal-connection`. GET devuelve la conexión vigente en `connection`, el candidato sin publicar en `draft`, `source` (`product`/`global`) y `encryptionConfigured`. La lectura exige `billing.catalog.read`; guardar, activar, cambiar estado o rotar exige `billing.catalog.manage`. No se devuelven secretos, ciphertext ni tokens; el Client ID identifica la app y sí es visible.

PUT guarda sólo el borrador: recibe `name` (1–120), `environment` (`sandbox`/`live`), `clientId` (1–255), `clientSecret` opcional (1–2048), `webhookId` (hasta 255), y al editar un borrador existente `draftId` y `expectedUpdatedAt`. No activa pagos ni cambia el estado de la conexión vigente. Se requiere un secreto nuevo para otra app o entorno; para la misma app puede conservarse el del borrador o copiarse el vigente, cifrándolo para el UUID del borrador. Un secreto vacío no significa conservarlo. Los conflictos por ID o versión obsoletos se rechazan con `409`.

Después de guardar, el panel muestra la URL del webhook del borrador. El operador registra esa URL pública HTTPS en la misma app de PayPal y guarda su Webhook ID. La acción **Activar conexión** es independiente de guardar: POST `/products/:id/paypal-connections/:draftId/activate`, bajo el mismo prefijo de catálogo, recibe `expectedUpdatedAt`, `expectedCurrentConnectionId` y `expectedCurrentUpdatedAt`; estos dos últimos son `null` si se hereda la configuración global. La operación bloquea el producto, comprueba las versiones, el secreto y el Webhook ID, y sustituye la vigente en una transacción. Si la app y el entorno son los mismos se conserva el ID vigente; si cambian, se promueve el ID del borrador y se conserva la anterior para sus contratos. No se registran webhooks ni se hacen cobros automáticamente.

PATCH `/products/:id/paypal-connections/:connectionId/status` recibe `{enabled:boolean}` y habilita o deshabilita únicamente la conexión vigente sin modificar el borrador. Una conexión vigente deshabilitada impide nuevas contrataciones y nunca cae silenciosamente a otra cuenta. Activar o habilitar sin Webhook ID se rechaza.

Un producto con sólo un borrador sigue usando la configuración global. Si hay conexiones publicadas históricas pero falta la vigente, GET y las nuevas contrataciones rechazan con `503` para evitar seleccionar otra cuenta. Los borradores quedan fuera de la resolución de cobros, las credenciales de operaciones y las tareas de recuperación.

Los contratos e intentos existentes fijan `providerConnectionId`; sus reintentos, cancelaciones y webhooks mantienen la app original. Los registros anteriores sin ese campo continúan con la configuración global.

GET `/products/:id/paypal-connections` devuelve el historial publicado, sin borradores. PATCH `/products/:id/paypal-connections/:connectionId` recibe `{clientSecret,webhookId?}` y mantiene credenciales históricas sin cambiar app, ambiente, producto, `enabled` ni `isCurrent`. Omitir Webhook ID lo conserva. El secreto nuevo es obligatorio y la conexión debe pertenecer al producto. Las credenciales históricas pueden usarse para operaciones existentes aunque ya no sean la conexión vigente o estén deshabilitadas.

## Planes y precios por conexión

Los IDs remotos de planes PayPal se asocian explícitamente a una conexión. Cada mapping de precio incluye `connectionScope` (`unassigned`, `global` o `connection`) y `providerConnectionId` (UUID para `connection`, `null` en los otros dos casos). Un precio puede conservar mappings para las apps A y B al mismo tiempo, con como máximo uno activo por proveedor y conexión.

Las compras nuevas resuelven el mapping de la conexión vigente del producto. Los cambios de plan, renovaciones y operaciones de un contrato existente resuelven el mapping de su conexión fijada, aunque otra app sea ahora la vigente. Si falta el mapping correspondiente, Billing responde `409` con `BILLING_PROVIDER_PRICE_NOT_CONFIGURED`; no utiliza el ID de otra app ni recurre a la global. El SDK conserva su contrato y no recibe credenciales, bindings administrativos ni borradores.

Los intentos nuevos fijan internamente tanto la conexión como el ID del mapping antes de llamar a PayPal. Archivar un mapping no cambia el ID congelado de un intento o contrato existente. Los registros históricos mantienen sus FKs e IDs remotos; nunca se reescriben para reutilizarlos en otra app.

En el detalle de la versión de un plan, cada precio permite **Vincular plan de PayPal** y archivar/reactivar asociaciones. La identidad del mapping (conexión, producto remoto e ID remoto de precio) es inmutable: para corregir un ID se archiva la asociación y se agrega otra. La configuración de una versión nueva conserva las asociaciones A/B al clonar y exige elegir explícitamente la conexión de cualquier fila heredada sin asignar; no elimina esas filas ni las convierte automáticamente a global.

Los complementos tienen las mismas asociaciones por conexión en `addon_provider_prices`. Al contratar un complemento se congela su ID remoto y conexión. `addons.provider_plan_id` se conserva como dato heredado de sólo lectura y no se usa para adivinar la app de altas nuevas.

Las opciones administrativas admiten configuración global explícita o conexiones vigentes/históricas del mismo producto; los borradores y conexiones ajenas se rechazan. Las acciones usan los permisos existentes `billing.catalog.read`/`billing.catalog.manage`.

Bajo `/api/v1/billing/console/catalog`:

- POST `/plan-prices/:priceId/provider-prices`: agrega una asociación a un precio existente.
- PATCH `/provider-prices/:id/status`: cambia únicamente su estado local.
- GET/POST `/addons/:id/provider-prices`: consulta/agrega asociaciones de un complemento.
- PATCH `/addon-provider-prices/:id/status`: cambia únicamente su estado local.

Un alta requiere `connectionScope: global` con `providerConnectionId: null`, o `connectionScope: connection` con el UUID autorizado, además de los identificadores remotos. Un conflicto entre asociaciones activas se devuelve como `409` con `BILLING_PROVIDER_PRICE_SCOPE_CONFLICT`. Archivar una asociación local no modifica el plan en PayPal.

### Migración y conciliación de precios existentes

`ProviderPriceConnections1794355200002` agrega el scope y la FK opcional en `provider_prices`, reemplaza la unicidad antigua por unicidad activa según conexión y crea `addon_provider_prices`. Conserva las filas e IDs originales como `unassigned`; copia cualquier `addons.provider_plan_id` heredado a una asociación sin asignar. No infiere que un ID pertenece a la app vigente.

La conciliación de datos se hace explícitamente, con evidencia del entorno y app que puede acceder al plan, agregando asociaciones sin reescribir los registros originales. Un ID desconocido o ausente queda pendiente de configuración. El rollback adquiere bloqueos y se detiene si existen asociaciones nuevas o estados que no puedan representarse en el esquema anterior; requiere reconciliación manual antes de revertir.

La migración se aplicó en la base de desarrollo `billing` el 11 de noviembre de 2026, junto con la conciliación en una sola transacción. Se conservaron exactamente las 12 filas originales de precios y sus IDs; se agregaron 8 asociaciones globales para IDs existentes de Balanz accesibles mediante la app global en Sandbox. La comprobación acredita acceso con esas credenciales, no una validación nueva de importes. Las 14 suscripciones existentes, complementos, checkouts, intentos y conexiones guardadas conservaron sus datos; se verificaron sus huellas antes de confirmar la transacción. No quedaron migraciones pendientes y se reiniciaron API y web.

Los 4 registros de precios Medsync sin ID remoto permanecen sin asignar. Para habilitar sus altas, agregar en el detalle de cada precio una asociación con la conexión Medsync y el ID del plan correspondiente en esa app PayPal. No se crearon planes remotos ni se realizaron pagos durante el despliegue.

## Cifrado y despliegue

`PAYPAL_CONNECTION_ENCRYPTION_KEY` contiene exactamente 32 bytes aleatorios codificados en base64. Guardarla en el gestor de secretos del despliegue y respaldarla fuera de la base. AES-256-GCM usa nonce nuevo por escritura y autentica el ID de la conexión. No reemplazar la clave sin un procedimiento explícito de recifrado: cambiarla vuelve ilegibles los secretos actuales e históricos. Sin una clave válida se rechaza guardar/rotar/descifrar con 503 y la UI muestra que el cifrado no está configurado.

La migración manual `ProductPaypalConnections1794355200000` agrega la tabla, una FK nullable para la conexión del inbox y deduplicación por conexión. También separa IDs remotos de suscripciones por conexión y reembolsos/cancelaciones por su agregado interno. No hay seeds, migraciones ni cambios de secretos al arrancar.

### Migración para separar borradores

La migración `PaypalConnectionDrafts1794355200001` añade una columna booleana `is_draft` con valor inicial `false`, un índice que permite un solo borrador por producto y una restricción que impide que un borrador sea vigente o esté habilitado. No reclasifica las conexiones actuales ni las históricas. El archivo `apps/api/src/database/migrations/1794355200001-paypal-connection-drafts.ts` aplica el DDL siguiente en una transacción. Las pruebas usan la migración real en PostgreSQL desechable, verifican rollback y reaplicación, y comprueban que los borradores impiden una reversión que los descartaría.

```sql
ALTER TABLE paypal_connections
  ADD COLUMN is_draft boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "IDX_paypal_connections_product_draft"
  ON paypal_connections(product_id) WHERE is_draft=true;
ALTER TABLE paypal_connections
  ADD CONSTRAINT "CHK_paypal_connections_draft_inactive"
  CHECK (NOT is_draft OR (NOT is_current AND NOT enabled));
```

El rollback bloquea la tabla dentro de su transacción antes de comprobar borradores, para impedir que un guardado concurrente pase entre la comprobación y el cambio de esquema:

```sql
BEGIN;
LOCK TABLE paypal_connections IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM paypal_connections WHERE is_draft=true) THEN
    RAISE EXCEPTION 'PayPal draft rollback requires explicit draft reconciliation';
  END IF;
END $$;
DROP INDEX "IDX_paypal_connections_product_draft";
ALTER TABLE paypal_connections
  DROP CONSTRAINT "CHK_paypal_connections_draft_inactive";
ALTER TABLE paypal_connections DROP COLUMN is_draft;
COMMIT;
```

El orden de despliegue es aplicar primero el esquema y después reiniciar API y web con el código nuevo. No combinar el formulario nuevo con el contrato anterior de la API. La migración ya se aplicó, con autorización del usuario, en la base de desarrollo `billing`; las conexiones existentes se conservaron y API y web se reiniciaron con el código nuevo. Otros entornos requieren ejecutar su propia migración antes del despliegue.

Antes de aplicar, revisar respaldo y detener escritores durante la transición de índices. La migración preserva los registros legacy con conexión null. El rollback aborta si existen conexiones guardadas o datos que no caben en las restricciones antiguas: no elimina credenciales ni fusiona historiales de apps distintas. Reconciliar explícitamente antes de intentar revertir.

Prueba aislada: `bash test/api/integration/paypal-connections/paypal-connections.docker.sh`, PostgreSQL desechable sin datos ni credenciales del despliegue. Las pruebas no contactan PayPal ni acreditan credenciales del proveedor; el operador debe completar esa comprobación en sandbox.
