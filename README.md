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

`@hemia/payments` usa Changesets y PR de versión en `main`. Consulta [releases de Payments](docs/payments-release.md) para CI, OIDC, publicación automática y consumo desde npm.
