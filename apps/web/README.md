# Web (Next.js)

Frontend del monorepo `nextjs-nestjs`. Consola Next.js (App Router) con Tailwind v4, ZUNO y componentes shadcn para los casos aún no migrados.

## Stack

- **Next.js 16** — App Router, React Server Components.
- **React 19**.
- **Tailwind CSS v4** — vía `@tailwindcss/postcss`, tokens en `src/app/globals.css`.
- **ZUNO 0.1.0-alpha.2** (sobre **@base-ui/react**) — componentes editables en `src/components/zuno`.
- **shadcn** — sidebar, tablas, breadcrumbs, paginación y menús con filtros de radio. Viven en `src/components/ui`.
- **lucide-react** — iconos.
- **class-variance-authority**, **clsx**, **tailwind-merge** — variantes y merge de clases.
- **TypeScript**, **ESLint**. Tema claro de Billing por defecto; el usuario puede activar el tema oscuro desde el menú de perfil. La elección se guarda en `localStorage`.
- Gestor de paquetes: **bun**.

## Estructura

```
apps/web/
  components.json                # registro ZUNO y destino @/components/zuno
  src/
    app/
      layout.tsx                 # layout raíz
      page.tsx                   # home
      globals.css                # paleta Hemia compartida y variantes claro/oscuro
      zuno-tokens.css           # tokens complementarios claro/oscuro de ZUNO
    components/
      app-sidebar.tsx, app-topbar.tsx, stat-card.tsx
      zuno/                      # primitivos ZUNO usados por la consola
      ui/                        # componentes shadcn aún necesarios
    lib/
      api/                       # cliente HTTP mínimo y sesión
      nav.ts, utils.ts           # navegación y helper cn()
```

Aliases: `@/components`, `@/components/zuno`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks`.

## Arranque

```bash
bun install
bun run --cwd apps/web dev      # http://localhost:5175
```

Configurar API:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3015/api/v1
```

El cliente HTTP vive en `src/lib/api` y usa cookies con
`credentials: "include"`. Los permisos en UI son best-effort cuando
`/auth/session` devuelve `scopes`; el backend sigue autorizando cada acción.

## Scripts

```bash
bun run --cwd apps/web dev
bun run --cwd apps/web build
bun run --cwd apps/web start
bun run --cwd apps/web lint
```

## Añadir componentes

Desde `apps/web`, ZUNO instala código editable en `src/components/zuno`:

```bash
bunx zunoui add <componente> --pm bun
```

Si ZUNO no ofrece el componente, instalarlo desde shadcn en su carpeta actual:

```bash
bunx shadcn add <componente> --path src/components/ui
```

`components.json` apunta por defecto a ZUNO. No sobrescribir componentes shadcn existentes.
