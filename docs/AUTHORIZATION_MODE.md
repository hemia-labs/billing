# Autorización por roles y permisos

Billing admite únicamente `HEMIA_AUTHORIZATION_MODE=roles` (valor predeterminado).
El valor temporal `authenticated` ya no es válido y bloquea el arranque con un
error de configuración. Una sesión SSO válida autentica al usuario; no concede
acciones de catálogo, datos de clientes ni administración de integraciones.

Access debe entregar asignaciones vigentes en un contexto firmado y Billing las
valida contra el catálogo publicado v1 o v2. Cada endpoint exige sus permisos y
calcula el alcance de sus propios roles: un permiso global no convierte en
globales las demás acciones. Los contextos vacíos, incompatibles o caducados se
rechazan. Las políticas de servicios/máquinas permanecen independientes.

`billing.webhook_viewer` del catálogo v2 permite únicamente
`billing.webhooks.read` con alcance `all_customers`. Permite consultar eventos,
detalles e historial; no permite reintentar, descargar payloads ni operar otros
recursos. Las demás funciones requieren sus propios roles, que pueden combinarse
sin conceder un comodín administrativo.

## Transición de despliegue

1. Inventariar las asignaciones efectivas y los alcances de los usuarios antes
   de retirar el modo temporal. No transformar automáticamente todo inicio de
   sesión en privilegios permanentes.
2. Asignar mediante Access los roles aprobados para cada función, conservando
   los límites por organización. La lectura global de webhooks no requiere
   otorgar reintentos globales.
3. Configurar `HEMIA_AUTHORIZATION_MODE=roles` en Billing y Access antes de
   arrancar las versiones estrictas. Si existe un override de Billing en Access,
   también debe ser `roles`. No modificar otros valores ni secretos.
4. Desplegar los consumidores compatibles y Access coordinadamente. Billing
   conserva la clave de caché `billing:roles`, separada de los contextos antiguos
   del modo temporal, y revalida cada mutación.
5. Verificar sesión, navegación y endpoints con los permisos reales: lectura
   permitida, mutaciones sin permiso denegadas y aislamiento entre organizaciones.

El código no concede roles, modifica asignaciones ni ejecuta migraciones/seeds
al iniciar. La preparación de permisos y el cambio de configuración son pasos
operativos separados y deben verificarse en el ambiente destino.
