# Publicación de @hemia/payments

El SDK se publica desde GitHub Actions a npm. Para este cambio se usan servicios locales y paquetes publicados: no hace falta generar ni instalar un `.tgz` local.

## Preparar el cambio

- El PR de funcionalidad conserva la versión actual de `packages/payments/package.json` y `bun.lock`.
- Incluye un Changeset de Payments con el impacto SemVer y otro de `api` para los endpoints del servidor. No ejecutes `changeset version` ni edites el changelog a mano.
- Revisa `bun run changeset status`. El cambio de conexiones solicita Payments `0.10.0` → `0.11.0` y Billing `1.2.0` → `1.3.0`; el PR automático calcula las versiones finales.
- Conserva las comprobaciones de CI existentes. La revisión local puede limitarse a tipos y pruebas del comportamiento modificado; el workflow valida el paquete y sus consumidores antes de publicar.

## Publicar por el flujo existente

1. Integra el PR de funcionalidad en `main` mediante la revisión habitual.
2. `release-payments.yml` valida el código y abre o actualiza el PR `chore(payments): release package versions` mediante Changesets. Ese PR actualiza versión, changelog y lockfile y consume solo las notas del SDK.
3. Revisa e integra ese PR de versión. La publicación solo se habilita para un merge compuesto por archivos de versión y Changesets consumidos; un merge de funcionalidad no publica.
4. Con `ENABLE_NPM_PUBLISH=true` y el entorno `npm` configurado, CI publica el mismo artefacto que validó, verifica su integridad en npm y crea el tag y GitHub Release `@hemia/payments@X.Y.Z`.
5. Verifica la versión en npm antes de instalarla en el consumidor. `@hemia/auth` debe estar publicado en una versión que cumpla el peer dependency `^1.1.0`; el script comprueba esta condición.

El paquete ya existe en npm. Para la publicación automática, su trusted publisher debe apuntar al repositorio `hemia-labs/billing`, workflow `release-payments.yml` y entorno `npm`. Las credenciales de los clientes OAuth de las aplicaciones no se usan para publicar paquetes. Si el gate o trusted publisher no está disponible, corrige esa configuración; no sustituyas el flujo con una publicación local.

La versión de las aplicaciones Billing sigue su propio workflow y PR `changeset-release/billing`; sus notas no se consumen con `version:payments`.

## Usar la conexión con servicios locales

1. Levanta Billing con los nuevos endpoints y Console con el guardado de snapshots.
2. Mantén el prefijo de API `/api/v1`, requerido por esta primera versión del resolver. El origen de Billing usado en `sso.redirectUri` debe coincidir con el de `HEMIA_BASE_URL`; Identity, token endpoint y audiencia deben corresponder al mismo entorno.
3. Guarda la conexión en Console. Este primer paso requiere **Consultar planes**, sin funciones OAuth directas adicionales; reutiliza `billing.integration.catalog.read` y no añade permisos de compra.
4. Instala el SDK publicado desde npm. Completa las cuatro variables que entrega Console y resuelve la conexión una vez al iniciar el backend, según el [ejemplo del SDK](../packages/payments/README.md#resolve-a-console-connection-0110).
5. Para HTTP local, activa `allowHttpLoopback` explícitamente fuera de producción. El secreto OAuth permanece en el backend o gestor de secretos; no forma parte del snapshot.
6. Comprueba la resolución y una consulta de planes antes de añadir otras operaciones. El resolver no sustituye la sesión, autorización ni aceptación explícita del usuario.

Console conserva la configuración completa en **Configuración avanzada** para los consumidores que siguen con `PAYMENTS_CONNECTION`. Los SDK anteriores y las conexiones sin catálogo mantienen ese flujo. No hay migraciones ni seeds nuevos para esta funcionalidad.
