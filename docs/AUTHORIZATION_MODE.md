# Modo temporal de autorización

`HEMIA_AUTHORIZATION_MODE` admite `roles` (predeterminado) y `authenticated` en el backend de Billing.

En `authenticated`, una sesión humana válida puede ejecutar todas las acciones del catálogo de Billing sin asignaciones de rol. Se conservan el login SSO, la verificación del contexto firmado de Access, sus identificadores y vencimiento, la membresía activa y el producto habilitado. Los datos de clientes permanecen limitados a la organización seleccionada. Los recursos compartidos de catálogo mantienen su alcance global. En el modo temporal, las políticas de clientes de servicio solo pueden consultarse o modificarse si su alcance previo y nuevo están limitados exclusivamente a la organización seleccionada; se rechazan políticas globales, compartidas con otras organizaciones o sin organización. No se asignan roles ni se escriben permisos en la base de datos.

Las políticas y permisos de servicios/máquinas no cambian. Las validaciones de datos y las reglas de cobros, suscripciones e integraciones siguen aplicándose.

## Activar

Configurar `HEMIA_AUTHORIZATION_MODE=authenticated` en los entornos de Access y Billing y recrear sus backends con las versiones compatibles. Access debe emitir el contexto firmado de la membresía activa, incluso cuando no existan asignaciones (`assignments: []`). No se deben editar JWT ni guardar tokens en el navegador. Las sesiones de Billing reciben la lista de acciones permitidas desde el backend; no hace falta configurar una variable pública en el frontend.

## Revertir

Cambiar la variable a `roles` (o retirarla) y recrear los backends. El modo forma parte de la clave de caché: cambiar de modo solicita un contexto nuevo para ese modo y no reutiliza el contexto del otro. Una asignación vacía se rechaza en modo `roles`. Las mutaciones siguen solicitando contexto actualizado. No es necesaria una migración ni cambiar usuarios o roles.

El modo `authenticated` amplía las acciones disponibles a usuarios autenticados, también en producción; usarlo solo mientras se prueba el flujo y restaurar `roles` al habilitar la autorización definitiva.
