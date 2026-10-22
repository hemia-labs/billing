# Releases de @hemia/payments

## Versiones y orden

Auth **1.1.0** con MachineClient ya está publicado en npm. Payments usa `@hemia/auth:^1.1.0` como peer y `1.1.0` para desarrollo y validación del tarball.

Payments está en 0.2.0 con Changesets pendientes: Changesets generará **0.3.0**. El publicador comprueba que exista una versión compatible de Auth en npm antes de publicar Payments.

El proyecto y los workflows fijan **Bun 1.4.4**. La versión 1.3.14 rechazaba el lockfile recién generado sin cambios; 1.4.4 acepta el grafo existente. CI instala todo el workspace con `bun install --frozen-lockfile`, sin resolver dependencias alternativas con npm. El versionador sincroniza la versión de Payments en `bun.lock` y vuelve a comprobar la instalación congelada.

## Flujo automático

1. PR de código con changeset hacia `main`; `package-payments.yml` comprueba tests, build, tipos e instalación del tarball.
2. Tras merge, `release-payments.yml` abre o actualiza un PR de versión usando Changesets.
3. Revisar y fusionar el PR de versión sin mezclar cambios de código. El publicador rechaza merges que no sean exclusivamente de versión/changelog/lockfile/changesets consumidos.
4. CI valida y conserva el tarball exacto como artifact `payments-release` con su commit e integridad.
5. Con `ENABLE_NPM_PUBLISH=true`, el job de publicación protegido por environment `npm` verifica el artifact y usa OIDC. No reconstruye el paquete y no guarda un NPM_TOKEN. Una versión ya publicada con otra integridad se rechaza.
6. Solo después de confirmar la misma versión e integridad en npm, el job crea el tag y el GitHub Release `@hemia/payments@<versión>` sobre el commit validado. El título es el mismo y las notas salen de la sección correspondiente de `packages/payments/CHANGELOG.md`. Un reintento completa el Release si npm ya publicó; no duplica un Release existente ni mueve un tag a otro commit. Usa `GITHUB_TOKEN` con `contents:write`, sin GitHub App ni token adicional.

Auth conserva su rama `develop` y usa el mismo flujo con `package-auth.yml`, `release-auth.yml`, `version:auth` y artifact `auth-release` en el repositorio `hemia-labs/identity`.

## Configuración de GitHub que debe comprobar un administrador

La conexión disponible no pudo consultar estos repositorios (404); estos puntos son requisitos, no configuración remota confirmada.

En `hemia-labs/billing` y `hemia-labs/identity`:

- GitHub Actions habilitado y rama de release existente: `main` en Billing y `develop` en Identity. Los workflows deben estar incluidos en el PR.
- Environment **npm** que permita despliegues desde la rama de release de cada repositorio; revisores/protecciones según la política del repositorio.
- Variable de repositorio **ENABLE_NPM_PUBLISH=true** solo después de preparar npm; con la variable ausente el job de publicación queda deshabilitado.
- Permitir crear PR desde Actions si se usa `GITHUB_TOKEN`. Los jobs de versión declaran `contents:write` y `pull-requests:write`.
- Payments usa únicamente el `GITHUB_TOKEN` automático: no requiere una GitHub App propia, PAT, RELEASE_APP_CLIENT_ID ni RELEASE_APP_PRIVATE_KEY. En Settings → Actions → General habilita **Allow GitHub Actions to create and approve pull requests**. Cuando el bot cree o actualice el PR de versión, un usuario con escritura debe seleccionar **Approve workflows to run** si GitHub muestra ese banner; después se revisa y fusiona normalmente. La automatización existente de Auth no se modifica. Referencia: https://docs.github.com/en/actions/concepts/security/github_token
- Si branch protection exige checks, incluir el check del paquete y no autorizar merges de versión sin validación.

No se necesita un secret NPM_TOKEN para publicaciones posteriores por OIDC. No se configuró ni modificó ningún secreto o ajuste remoto durante esta preparación.

## Configuración npm

Se requiere permiso de publicación en el scope `@hemia` y acceso público para ambos paquetes. En cada paquete configura Trusted Publisher con estos valores exactos:

| Campo | Auth | Payments |
|---|---|---|
| Organización GitHub | hemia-labs | hemia-labs |
| Repositorio | identity | billing |
| Workflow | release-auth.yml | release-payments.yml |
| Environment | npm | npm |
| Acción permitida | npm publish | npm publish |

Los workflows usan runner hospedado por GitHub, Node24, npm11.15.0 e `id-token:write` en el job de publicación. Los metadatos repository.url deben coincidir con el repositorio. OIDC no autentica la instalación de dependencias privadas: si se agregan, hará falta un token separado de solo lectura.

Referencia oficial: https://docs.npmjs.com/trusted-publishers/

## Publicación inicial completada

`@hemia/payments@0.2.0` y `@hemia/auth@1.1.0` están publicados y verificados en npm. Los consumidores usan versiones npm y se retiraron los tarballs estáticos de vendor. Las pruebas de distribución siguen generando tarballs temporales para validar el paquete candidato; no son dependencias vendorizadas.

Para activar las siguientes publicaciones, en npm abre Settings → Trusted Publisher de `@hemia/payments`, selecciona GitHub Actions y configura:

- Organization or user: `hemia-labs`.
- Repository: `billing`.
- Workflow filename: `release-payments.yml`.
- Environment name: `npm`.
- Allowed actions: permitir `npm publish`.

En GitHub crea el environment `npm`, permite la rama `main` y activa la variable de repositorio `ENABLE_NPM_PUBLISH=true`. El workflow usa OIDC y no requiere NPM_TOKEN ni GitHub App. Debe estar incluido en `main`. Tras configurar npm, fusionar el próximo PR exclusivo de versión publicará **0.3.0**. No se vuelve a publicar 0.2.0.

## Validación local

```sh
bun --version # 1.4.4
bun install --frozen-lockfile
bun run changeset status
bun run test:release
bun run --cwd packages/payments typecheck
bun run --cwd packages/payments build
bun run --cwd packages/payments test
bun run --cwd packages/payments test:nest
bun run test:payments:tarball
```

La instalación congelada debe pasar desde un checkout limpio. Las verificaciones del SDK y su tarball consumen Auth 1.1.0 de npm.

## Consumo desde npm

Balanz instala `@hemia/payments@0.2.0` y `@hemia/auth@1.1.0`; Console usa Auth 1.1.0. Billing desarrolla su SDK contra Auth 1.1.0 de npm. Los tarballs de release se generan y conservan como artifacts para validar sus bytes antes de publicar.
