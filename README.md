# nextjs-nestjs

Monorepo con **Next.js** (frontend) y **NestJS** (backend), gestionado con **bun workspaces**.

## Apps

| App | Stack | Puerto | README |
|-----|-------|--------|--------|
| [`apps/web`](apps/web) | Next.js 16, React 19, Tailwind v4, shadcn | 5175 | [ver](apps/web/README.md) |
| [`apps/api`](apps/api) | NestJS 11, TypeORM, PostgreSQL | 3015 | [ver](apps/api/README.md) |

> La API requiere PostgreSQL, Redis y la configuración de identidad/acceso. Configura las conexiones según `apps/api/README.md`; las migraciones y seeds se ejecutan explícitamente.

## Requisitos

- [bun](https://bun.sh)
- PostgreSQL y Redis para el backend

## Arranque

```bash
bun install

bun run dev        # inicia frontend; ejecutar dev:api en otra terminal
bun run dev:web    # solo frontend (http://localhost:5175)
bun run dev:api    # solo backend  (http://localhost:3015)
```

## Build

```bash
bun run build      # build de todas las apps
```

## Estructura

```
nextjs-nestjs/
  apps/
    web/   # Next.js (App Router, Tailwind v4, shadcn) — ver apps/web/README.md
    api/   # NestJS (TypeORM, PostgreSQL) — ver apps/api/README.md
  test/          # todas las pruebas y runners de API y web
  package.json   # workspaces + scripts root
```

Cada app documenta su stack, variables de entorno y comandos en su propio README.

## Pruebas

Desde esta raíz, `bun run test` ejecuta las suites Jest de API y las pruebas Bun de Fevex y frontend. Todas viven en `test/`; estructura y runners desechables en [test/README.md](test/README.md).

## Publicación del SDK de pagos

`@hemia/payments` usa Changesets y PR de versión en `main`.

## Docker en producción

Requiere Docker Compose 2.30 o posterior y PostgreSQL, Redis y RabbitMQ externos.
La API recibe `apps/api/.env.production` en tiempo de ejecución; los archivos de
entorno, secretos y logs quedan fuera del contexto de construcción.

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
docker stats --no-stream
```

El proxy HTTPS del servidor debe dirigir `billing.hemia.cloud/api/v1` y
`billing.hemia.cloud/auth` a `127.0.0.1:3015`, conservando las rutas, y el resto
a `127.0.0.1:5175`. Debe preservar `Host`, cookies y los encabezados forwarded.
Los puertos solo se publican en loopback por defecto. Si el proxy está en otro
contenedor, conéctalo a la red de Compose y usa `backend:3015` y `frontend:5175`.

Next.js compila la URL pública durante el build. El valor predeterminado es
`https://billing.hemia.cloud/api/v1`; para cambiarlo, reconstruye la imagen:

```bash
BILLING_PUBLIC_API_URL=https://billing.hemia.cloud/api/v1 docker compose build frontend
```

El frontend no carga `apps/web/.env.production` en runtime: solo necesita esa
URL pública al construir. La API ejecuta JavaScript compilado y el frontend usa
Next.js standalone, ambos sin usuario root ni herramientas de desarrollo.
Los límites iniciales son 512 MiB / 1 CPU para API y 256 MiB / 0.5 CPU para web;
no son mediciones de consumo y deben ajustarse con carga real. Los logs rotan
a 3 archivos de 10 MB por servicio. Los healthchecks verifican HTTP, no el
estado de cada dependencia externa. No se ejecutan migraciones ni seeds al arrancar.

En produccion sin PAC, definir explicitamente `BILLING_FISCAL_PROVIDER=disabled`.
Esto permite arrancar Billing, pero emitir o cancelar CFDI permanece bloqueado
con HTTP 501. No se crean resultados fiscales simulados. `noop` no permite
arrancar en produccion.

## Publicación y despliegue privado en apps

El flujo de la aplicación es independiente del SDK de pagos. GitHub Actions
construye y prueba imágenes `linux/amd64`, las publica por Tailscale en
`registry.tail41610c.ts.net/billing/backend` y `/billing/frontend`, y crea una
Release inmutable `billing-vMAJOR.MINOR.PATCH`. La VM apps descarga las imágenes
por digest; no clona el repositorio ni compila. El Compose anterior permite
construcciones locales; las releases contienen un `compose.json` sin `build`.

Al integrar cambios en `main`, **Billing release** valida la aplicacion y crea
un PR de version `changeset-release/billing` cuando existen Changesets para API o
web. API y panel comparten version; el primer changeset solicita `1.0.0`.
Al fusionar ese PR de version, vuelve a ejecutar CI, publica el tag
`billing-vX.Y.Z` y la Release `Billing X.Y.Z` con las notas de ambos changelogs.
Despues llama a **Billing deployment**, sujeto a `ENABLE_BILLING_DEPLOY=true`.

El SDK mantiene sus tags `@hemia/payments@X.Y.Z` y su workflow independiente.
Los comandos `version:billing` y `version:payments` consumen solo los Changesets de
su producto y restauran la configuracion compartida incluso si falla Changesets.
Una nota que mezcle aplicacion y SDK debe dividirse antes de versionar.
`bun run changeset` permite elegir API, web o Payments; la deteccion del workflow
de Payments filtra exclusivamente ese paquete.

Los PR creados con `GITHUB_TOKEN` no disparan otro workflow automaticamente.
Configurar `RELEASE_APP_CLIENT_ID` y `RELEASE_APP_PRIVATE_KEY` con una GitHub App
permite CI automatico en el PR de version de Billing; sin ella, ejecutar
**Billing CI** manualmente en esa rama antes de fusionarla.

El disparador manual de **Billing release** solo permite reintentar la version
ya comprometida en `main`; no admite versiones arbitrarias. Se rechaza
sobrescribir imagenes o releases existentes. Una publicacion interrumpida
requiere revisar sus imagenes y assets antes de recuperarla.

La Release contiene `release.json`, `compose.json` y `billing-deploy.py`:
commit, imágenes por SHA-256, hashes de assets y manifiesto de migraciones.
El despliegue verifica la Release inmutable, su pertenencia a `main`, los hashes
y el registry esperado antes de descargarla. Usa `docker compose pull` y
`up --no-build --wait`. Conserva `current`, `previous` e historial para rollback.

En apps, el usuario `billing-deploy` pertenece al grupo `docker` y tiene una
clave SSH dedicada. Ese grupo equivale a acceso de administrador al host,
igual que en Identity. Directorios y configuración:

```text
/opt/hemia/billing/
├── shared/
│   ├── production.env   # API; modo 600, fuera de Git y releases
│   └── host.json        # modo 600; bind, puertos, dominio y registry
├── releases/billing-vX.Y.Z/
│   ├── release.json
│   ├── compose.json
│   └── billing-deploy.py
├── current -> releases/billing-vX.Y.Z
├── previous -> releases/billing-vX.Y.Z
└── history.jsonl
```

`host.json` usa `bind_address=192.168.100.102`, `api_port=3015`, `web_port=5175`,
`public_url=https://billing.hemia.cloud` y
`registry_host=registry.tail41610c.ts.net`. Los directorios son modo 700.
El env se copió desde `apps/api/.env.production`: no se imprime ni se adjunta a
GitHub. Compose usa formato `raw`: un valor por línea, sin comillas envolventes.
Los cambios posteriores al env local no sincronizan automáticamente el servidor.

La cuenta `billing-ci` puede publicar; `billing-apps` solo permite GET/HEAD.
Su autenticación reside en `/home/billing-deploy/.docker/config.json`, modo 600,
con directorio modo 700. Las cuentas siguen la política de Identity: restricción
por método HTTP, no aislamiento por namespace. Los administradores del registry
conservan sus credenciales en archivos root-only del CT 140. No se instala la
credencial de escritura en apps. La API no recibe credenciales del registry.

El environment GitHub **prod** tiene estas variables:

| Variable | Valor |
|---|---|
| `REGISTRY_HOST` | `registry.tail41610c.ts.net` |
| `REGISTRY_USERNAME` | `billing-ci` |
| `DEPLOY_HOST` | `192.168.100.102` |
| `DEPLOY_USER` | `billing-deploy` |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_PATH` | `/opt/hemia/billing` |
| `ENABLE_BILLING_DEPLOY` | `false`, habilitar al completar DNS, proxy y dependencias |
| `TS_CLIENT_ID`, `TS_AUDIENCE` | Identidad OIDC compartida de Hemia CI |

Secrets cifrados del mismo environment: `REGISTRY_PASSWORD`,
`DEPLOY_SSH_PRIVATE_KEY` y `DEPLOY_SSH_KNOWN_HOSTS`. Se habilitaron Releases
inmutables. Tailscale usa OIDC, no una clave permanente; la identidad compartida
admite repositorios `hemia-labs/*` con environment `prod` y rama `main`.
El runner necesita registry TCP 443 y apps TCP 22, según la política existente.

Con `ENABLE_BILLING_DEPLOY=true`, publicar una Release solicita su despliegue.
También se puede ejecutar **Billing deployment** desde `main` para `deploy`,
`rollback` o `migrate` de una Release ya publicada. El despliegue permanece
bloqueado con la variable deshabilitada, también para operaciones manuales.
No se ejecutan migraciones ni seeds automáticamente: si el preflight detecta
migraciones pendientes falla antes de sustituir contenedores. La operación
`migrate` exige confirmar un backup con `I_HAVE_A_BACKUP`; el rollback exige
revisar compatibilidad si cambia el manifiesto de migraciones. El controlador
actual exige configuración DB por entorno; rechaza Vault porque el CLI de
migraciones consume `DB_*` directamente.

El virtual host de Billing ya está instalado en el gateway (CT 120), como
`/etc/nginx/sites-available/billing.conf`, habilitado en `sites-enabled`.
Su fuente está en `deploy/nginx/billing.conf`. Nginx recibe HTTP con
`Host: billing.hemia.cloud`, conserva `/api/v1` y `/auth` hacia apps:3015,
y dirige el resto a apps:5175. HTTPS termina en Cloudflare. La sintaxis y la
recarga se verificaron; Identity siguió respondiendo HTTP 200. Los upstreams
de Billing aún rechazan conexiones hasta desplegar sus contenedores.

El hostname `billing.hemia.cloud` ya está configurado en el túnel
`homelab-gateway` de Cloudflare hacia `http://192.168.100.104:80`, con
`httpHostHeader=billing.hemia.cloud`. El registro DNS CNAME apunta a ese túnel;
las reglas de Identity, Access y el fallback 404 se conservaron. Las pruebas
públicas confirmaron la llegada al Nginx y a los upstreams correctos, que aún
rechazan conexiones hasta desplegar Billing. No apuntarlo directamente a
apps:5175, porque evitaría el enrutamiento de API/auth. Excluir API/auth y
respuestas personales de caché. El respaldo previo de Nginx está en
`/root/nginx-backups/before-billing-20261025T061309Z.tar.gz` dentro del gateway.

Pendientes antes del primer despliegue: integrar workflows en `main`, publicar
la primera Release, verificar la disponibilidad real de Access/Legal y configurar
reglas de firewall que limiten los puertos de apps al gateway. No habilitar despliegues
hasta verificar esos destinos y el esquema de base de datos.

Estado verificado el 25 de octubre de 2026: CI y workflows de aplicacion siguen
locales; en GitHub solo esta activo el flujo de Payments. `ENABLE_BILLING_DEPLOY`
permanece en `false`. Los puertos 3015/5175 aun no tienen reglas DOCKER-USER que
los restrinjan al gateway. La configuracion PostgreSQL de produccion usa
`billing_prod`, copia completa de `billing`, con el mismo usuario de desarrollo
`admin`, por indicacion explicita del usuario. Ambos env de produccion estan
sincronizados y la conexion y migraciones pendientes se comprobaron sin escrituras. Redis DB 1,
RabbitMQ y credenciales OAuth contra identity_prod se validaron desde apps.
El env de produccion local y el del servidor tienen
`BILLING_FISCAL_PROVIDER=disabled`, por indicacion del usuario. Ninguna de estas
comprobaciones publico una release, inicio Billing o modifico bases reales.

Validacion completa local (Node 24 y Bun 1.4.4):

```bash
bash scripts/billing-checks.sh
```

Incluye pruebas API y web, versionado real sobre repositorios temporales,
lint/build, imagenes de produccion y arranque sin Vault con PostgreSQL, Redis y
RabbitMQ desechables. Las migraciones del smoke solo se ejecutan en su propia
base efimera; no ejecuta seeds ni usa credenciales reales. La construccion amd64
se validara en GitHub Actions sobre un runner amd64; la comprobacion local se
realizo en arm64 tras un fallo de emulacion QEMU.

Pruebas offline de release, exclusión de secretos y despliegue simulado:

```bash
python3 -m unittest discover -s test/deploy -p 'test_*.py'
```
