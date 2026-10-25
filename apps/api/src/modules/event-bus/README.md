# Comunicación Access–Billing

Billing consume RabbitMQ mediante `@hemia/event-bus@0.0.3`, publicado en npm y fijado en el manifest y lockfile. Exchange `hemia.events`; cola duradera propia `hemia-billing.access`. Las réplicas de Billing comparten esta cola; Legal conserva la suya.

## Eventos implementados

| Eventos | Efecto |
| --- | --- |
| `access.membership.context_invalidated.v1` | Invalida sesiones por issuer y subject de Access. Exige membresía, referencia de identidad, organización, motivo y versión positiva. |
| `access.membership.suspended.v1`, `revoked.v1`, `role_assigned.v1`, `role_revoked.v1` | Invalida las sesiones de la identidad afectada. |
| `access.organization.eligibility_changed.v1`, `suspended.v1`, `archived.v1` | Invalida sesiones que contienen esa organización en su contexto de Access. |
| `access.organization_product.suspended.v1`, `disabled.v1`, `failed.v1` | Invalida sesiones de la organización únicamente cuando `product_code` es `billing`. |

Se valida el origen `urn:hemia:service:hemia-access`, ID y payload. La identidad se compara por issuer y subject; nunca por correo o subject aislado. Los nombres de asignaciones/delegaciones de sistema no se inventan ni se aceptan: se agregarán cuando Access implemente y publique esos contratos.

## Sesiones e idempotencia

Se reutiliza Redis y el formato de sesiones de `@hemia/auth@1.0.8`: `sso:session:*`, `accessContext.identity` y `accessContext.organizations`. Billing debe usar su propia base Redis de sesiones; estas claves no distinguen productos dentro de una misma base.

El consumidor recorre sesiones por lotes de SCAN (COUNT 100), selecciona las afectadas y las relee bajo el mismo bloqueo `sso:refresh:<id>` de 30 segundos usado por refresh/logout del SDK antes de eliminarlas. Para eventos de membresía versionados conserva contextos cuya versión ya es igual o superior a la recibida. Una identidad puede invalidarse aunque la organización indicada ya no figure en su contexto.

No se crea inbox ni outbox: esta integración solo elimina sesiones, sin efectos persistentes de negocio. La eliminación es idempotente; si falla Redis a mitad del procesamiento se propaga el error al SDK de RabbitMQ, que aplica su política de reintentos/dead letter. Una nueva entrega repite el recorrido y termina la invalidación. No se marca el evento consumido antes de completar.

Los avisos de organización sin versión comparable pueden volver a eliminar sesiones ante entregas duplicadas. No conceden roles ni reactivan acceso. El barrido es proporcional al número de sesiones; requiere medición con volumen real. Un índice de sesiones por identidad/organización sería una mejora posterior si ese coste lo exige.

No se garantiza revocación instantánea, ni se cancelan peticiones ya iniciadas o callbacks concurrentes. La expiración y la resolución contra Access siguen siendo necesarias. La consola verifica el contrato `assignments` v1 mediante `BillingConsoleSessionService` y el SDK 1.0.8: reutiliza el contexto en GET/HEAD hasta 60 segundos y resuelve contra Access cada mutación. La ventana no se extiende con lecturas ni fallos. No acepta `global_roles`/`permissions` como autorización. Cada acción se evalúa contra el catálogo local y los destinos de sus asignaciones; los eventos aceleran la eliminación de sesiones, e invalidan generaciones de la caché antes del barrido. Sin eventos, una lectura puede conservar autoridad hasta el vencimiento del contexto (máximo 60 segundos); las mutaciones exigen autorización fresca.

## Configuración

- `AMQP_URL`: URI amqp/amqps; obligatoria con eventos habilitados y en producción. No incluir credenciales en documentación ni logs.
- `EVENT_BUS_ENABLED=true`: habilita el consumidor en desarrollo. En producción se habilita siempre.
- `EVENT_BUS_PREFETCH=10`: entre 1 y 100.
- El usuario RabbitMQ necesita consumir la cola de Billing y declarar/vincular la topología utilizada por el SDK.

La conexión se inicia al arrancar el módulo de eventos; una conexión inicial fallida impide completar el arranque cuando está habilitado. No se modificaron variables del despliegue.

## Verificación y alcance

Pruebas unitarias: cola independiente, separación de identidades/organizaciones/productos, validación, versiones, repetición tras fallo de Redis y coordinación con refresh. Compilación y pruebas no requieren broker ni BD. La aceptación integrada con RabbitMQ/Redis reales se registra en `identity-access/docs/migracion/ambiente-integrado-billing.md`. Las mediciones con carga representativa siguen pendientes.

No se ejecutan migraciones ni seeds. No se agregaron tenants de sesión, tablas de autorización ni outbox local. Cuando Billing publique hechos propios que deban guardarse con su negocio, necesitará un outbox transaccional con ID y fecha estables.

## Recuperación de conexión

El SDK 0.0.3 publicado incluye las correcciones de la antigua copia local 0.0.4: reconecta y restaura topología/suscripciones. Retry y DLQ requieren confirmación antes del ACK original. Los resultados inciertos pueden duplicarse; se conserva el ID estable del outbox. No se garantiza entrega exactamente una vez.

## Observabilidad pendiente

La instrumentación local de conexión RabbitMQ, dependencias, HTTP y pool fue retirada de Billing. La evidencia histórica de carga y entrega/resolución de alertas locales está documentada en `docs/operacion-sso.md`. TODO: integrar métricas y alertas con HORUS, el software propio elegido para producción; no se requiere desplegar Prometheus/Alertmanager.
