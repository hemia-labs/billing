# Pruebas de Billing

Todas las pruebas, fixtures, configuraciones y runners pertenecen a `billing/test/`. No colocar pruebas junto a módulos de producción ni bajo `apps/*/test`.

## Estructura

- `api/unit/`: 31 suites Jest organizadas por módulo y la suite Bun de Fevex en `copilot/`.
- `api/integration/authorization/`: autorización y concurrencia de checkout sobre PostgreSQL desechable.
- `api/integration/context-cache/`: caché y sesión con Redis desechable.
- `api/integration/subscription-addons/`: construcción de SQL y cancelación contra PostgreSQL explícitamente desechable.
- `api/tsconfig.json`: resolución de tipos y dependencias de las pruebas de API.
- `api/jest-e2e.json`: configuración conservada para futuras suites `*.e2e-spec.ts`; actualmente no hay casos E2E de aplicación.
- `web/`: pruebas Bun de frontend por feature y su `tsconfig.json` de resolución.
- `payments/package/`: instalación y exports del tarball publicable del SDK.
- `payments/integration/atlas/`: host Nest independiente con PostgreSQL desechable para pagos y Legal opcional.

## Ejecución habitual

Desde la raíz Billing:

```sh
bun run test
bun run test:api
bun run test:web
bun run build
```

`test` ejecuta Jest, Fevex y frontend sin watch. También se pueden usar `bun run test` y `bun run test:bun` desde `apps/api`, o `bun run test` desde `apps/web`. Las pruebas HTTP con dobles de dependencias permanecen en `api/unit`; no se presentan como integraciones contra servicios reales.

Jest prioriza `apps/api/node_modules`, usa `api/tsconfig.json` y solo descubre `api/unit/**/*.spec.ts`. Bun recibe explícitamente la configuración correspondiente: no depende de paquetes instalados en la raíz por otras herramientas.

## Integraciones desechables

Desde `apps/api`, tras compilar:

```sh
bun run test:authorization:docker
bun run test:redis
bun run test:addon-cancellation:docker
```

Los tres requieren Docker e imágenes PostgreSQL/Redis y eliminan sus contenedores al terminar. El runner de cancelación crea únicamente su fixture de tablas en una base nueva y vacía; verifica SQL, bloqueo entre workers, auditoría y actualización de entitlements. Su archivo `.integration.cjs` permite comprobar solo SQL sin conexión cuando se invoca directamente sin `TEST_DATABASE_PORT`. No usar bases configuradas, producción ni proveedores reales. Los runners no cargan credenciales de `.env` y las migraciones de la integración PostgreSQL se ejecutan explícitamente antes de probar, nunca durante el arranque de la aplicación.

Los módulos y servicios se agrupan sin cambiar su lógica; los imports de pruebas apuntan a su ubicación vigente y los barrels de producción conservan sus exports.

## SDK de pagos

```sh
bun run test:payments:tarball
bun run --cwd packages/payments build
bash test/payments/integration/atlas/verify.sh
```

La integración requiere Docker y conserva la infraestructura de prueba fuera de `packages/payments`. No usa bases ni credenciales residentes.
