# Integración del SDK de pagos en un host independiente

Esta suite conserva Atlas como fixture de regresión fuera del paquete publicable. No es una aplicación de producto ni un login de producción. Las instrucciones de integración están en `packages/payments/README.md`.

Desde la raíz Billing, con Node20.19+, npm y Docker:

```sh
bun run --cwd packages/payments build
bash test/payments/integration/atlas/verify.sh
```

El runner empaqueta el SDK actual o usa `PAYMENTS_TARBALL=/ruta/paquete.tgz`, instala el artefacto en una carpeta temporal y crea PostgreSQL18.4 desechable. Limpia carpeta, contenedor y volumen al terminar; no lee `.env` ni usa bases residentes.

Comprueba el módulo Nest instalado con conexión JSON y DataSource del host, ausencia de migraciones al arrancar, migración explícita, autorización/origen, aislamiento, recibos durables, reinicio, concurrencia y reintentos, firma/introspección de tokens y actualizaciones de licencia. Incluye pagos sin Legal y la variante opcional con callback de contexto.

`app.cjs` es el host mínimo; `authorization.cjs` contiene sesiones de prueba; `migrate.cjs` aplica el esquema explícitamente. `upstream.fixture.cjs` simula Identity, Billing y Legal por HTTP. Nest, SDK, guards, firmas JWT y PostgreSQL son reales; no hay cobros PayPal ni SSO comercial.
