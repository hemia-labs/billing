# Autorización de la consola Billing

La sesión OAuth sigue en Redis y el navegador recibe solo una cookie opaca. `BillingConsoleSessionService` usa `SystemContextCache` de `@hemia/auth` 1.0.8: GET/HEAD reutilizan contexto verificado por hasta 60 segundos; toda mutación exige consulta reciente. El SDK verifica firma RS256/JWKS, tipo `hemia-context+jwt`, audiencia escalar `billing-api`, issuer configurado y vigencia. El issuer esperado es `access.apiBaseUrl` sin slash final. La ventana se limita por inicio de resolución, `iat + 60` y `exp`, sin prórroga por lecturas o fallos. Redis comparte entradas y bloqueo entre instancias; cada clave distingue sesión, emisor/sujeto, organización, membership, producto y audiencia. Billing revalida claims, permisos y alcance en cada petición.

El consumidor publica una generación de invalidación en Redis antes de eliminar sesiones y confirmar el evento. Las generaciones impiden reutilizar contextos anteriores e instalar resultados de resoluciones iniciadas antes del evento. Eventos duplicados/desordenados pueden renovar de más, nunca restauran permisos. Si no llega un evento, una lectura puede usar autorización anterior hasta 60 segundos; no se cancelan solicitudes ya autorizadas. Durante una caída de Access solo continúan lecturas dentro de esa ventana y no invalidadas; mutaciones/renovaciones se deniegan. Si Redis falla, no se recurre a memoria local. Logout elimina la sesión y bloquea reutilización. La selección de organización es POST y siempre exige resolución nueva.


`billing-console-permissions.ts` valida exactamente el contrato v1 y los catálogos conocidos v1/v2, la identidad ligada a la sesión, organización, membership, TTL máximo de 300 segundos y las asignaciones. No admite los antiguos `global_roles`, `permissions` ni campos desconocidos en ese JWT. `billing-authorization-v1.json` conserva las seis definiciones de rol y 19 acciones originales. `billing-authorization-v2.json` las incluye sin cambios y añade `billing.webhook_viewer` (Consulta de webhooks), con alcance exclusivo `all_customers` y permiso único `billing.webhooks.read`. El catálogo firmado determina tanto la validación de asignaciones como el mapa local de permisos; versiones desconocidas devuelven 409. Identity no recibe este mapa.

El lector global puede consultar listados, detalles e historial de reintentos. No puede reintentar, descargar payloads ni administrar catálogo, pagos u otros recursos. Sigue necesitando una sesión y una membresía activa de Access para Billing; `all_customers` amplía únicamente el alcance de lectura de webhooks. Todas las funciones requieren `HEMIA_AUTHORIZATION_MODE=roles`; el antiguo modo `authenticated` se rechaza al arrancar. Una sesión por sí sola no concede permisos.

`PermissionsGuard` calcula el alcance de cada acción sin combinar privilegios de asignaciones incompatibles. Por ejemplo, `viewer/all_customers` + `invoice_operator/organizations:[Acme]` solo autoriza facturas de Acme. Los permisos agregados de la respuesta de sesión se usan para navegación; no son autoridad del backend.

Los listados de suscripciones, checkouts, licencias, facturas y auditoría aplican los destinos antes de paginar/contar; el dashboard calcula agregados reales sobre ese conjunto. Los detalles y escrituras comprueban el propietario de la fila almacenada, y los add-ons resuelven el propietario desde su suscripción. Nunca se concede acceso usando el `organization_id` proporcionado por el solicitante.

Los webhooks verificados resuelven organización desde referencias PayPal hacia suscripciones, add-ons y pagos locales. Si la relación es única, el alcance restringido se aplica a listados, detalles, dashboard y reintentos; estos revalidan dentro de la transacción. Relaciones desconocidas/ambiguas deniegan. Ni `organization_id` ni metadata libre del payload conceden autoridad.

Todas las escrituras de consola reciben contexto nuevo, incluidas publicación de catálogo, emisión/cancelación de facturas, verificación de checkout, creación/cancelación de add-ons y reintento de webhooks. La revocación no cancela solicitudes que ya estaban autorizadas y ejecutándose ni crea una transacción distribuida con los proveedores externos.

Errores de Access 401/403/409/503 conservan su estado. Los errores de contrato/catálogo son 409; fallos de validación deniegan y fallos de disponibilidad bloquean. No se envían tokens ni asignaciones completas al navegador.

## Entrega y activación

El SDK se instala desde npm como `@hemia/auth@1.0.8` y queda fijado en `bun.lock`. Desplegar Access y Billing coordinadamente y volver a autenticar sesiones incompatibles. Este cambio no requiere nuevas tablas Billing ni concede roles por ser administrador organizacional. Para activar el lector global, desplegar primero Billing compatible con los catálogos v1/v2 y después publicar/activar el catálogo v2 en Access y crear la concesión explícita `billing.webhook_viewer` con alcance `all_customers`. No modificar ni retirar el catálogo v1 mientras puedan existir consumidores o contextos anteriores. Los demás operadores conservan sus permisos. No se publican catálogos ni asignaciones automáticamente; esas operaciones ya están disponibles en las APIs administrativas de Access y requieren ejecución explícita por ambiente.

Pruebas: `bun run test -- --runInBand` en `apps/api`; validan contrato estricto, alcances, separación entre clientes y rechazos de Access. La suite Docker de Access valida el emisor real contra PostgreSQL y el SDK prueba firmas con JWKS local. La prueba de despliegue integral y las mediciones de carga siguen pendientes.


## Correcciones de operaciones sensibles

Las rutas genéricas de catálogo solo crean/editan versiones draft, incluso anidadas en planes. Publicar exige `billing.catalog.publish` y serializa por plan la transición/archivo de la versión anterior. El frontend tiene una acción explícita de publicación.

Las facturas reciben el operador de la sesión verificada, con issuer, subject, referencia de Access y trace ID de servidor. El registro de auditoría conserva esos datos y el resultado. La creación bloquea el pago para impedir facturas activas duplicadas; emisión/cancelación reservan una operación persistente antes de contactar al proveedor. Se pasa una clave estable `invoice:<id>:issue|cancel` al adaptador. Peticiones concurrentes se rechazan y las completadas se reproducen sin llamar de nuevo al proveedor.

Ante un timeout/crash, la reserva permanece pendiente o incierta y bloquea reenvíos automáticos. El operador debe consultar el resultado en el proveedor y reconciliar mediante los endpoints internos `markIssued`, `markFailed` o `markCancelled`, protegidos por bearer de servicio; estas transiciones usan bloqueo y auditoría atómica. `markFailed` solo se usa tras confirmar que no se emitió. No borrar la reserva para intentar nuevamente. El adaptador actual es Noop y bloquea producción: debe implementarse/configurarse un PAC que respete idempotencia y reconciliación antes del despliegue fiscal real.

Las integraciones aceptan exclusivamente bearer de máquina. Se retiraron el guard, flags y configuración de API key de entrada. La UI acepta únicamente permisos explícitos y filtra la navegación por rol. Algunas pantallas operativas siguen siendo provisionales; compilar no certifica su aceptación completa.

Prueba aislada: `bun run test:authorization:docker` aplica migraciones únicamente en una base Docker vacía, usa datos sintéticos y proveedor simulado, y elimina el contenedor al finalizar. Comprueba reservas/replay, concurrencia, reconciliación, rollback de auditoría, publicación alternativa/concurrente y propiedad de webhooks. No accede a bases configuradas ni a proveedores reales.

Prueba de caché con Redis real aislado: después de compilar API, ejecutar `bun run test:redis` desde `apps/api`. Crea y elimina un contenedor desechable; comprueba dos conexiones, renovación concurrente, TTL, invalidación durante resolución y logout. No utiliza Redis configurado ni datos de aplicación.

Ambiente integrado preparado el 2026-09-16: catálogo y concesiones reales de desarrollo, RabbitMQ habilitado, catorce casos HTTP verificados y ventana real de caída de Access. Reporte: `/Users/cristianmendez/Documents/github/identity-access/docs/migracion/ambiente-integrado-billing.md`. SDK 1.0.7 comparte clases DI entre core y NestJS y corrige el fallo de arranque. No se publicó al registro ni se configuró un proveedor fiscal real.
