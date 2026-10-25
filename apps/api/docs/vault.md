# Vault en Billing

`SECRETS_ENABLED=true` activa la lectura con `@hemia/secrets` y AppRole. El scope
predeterminado es `dev/internal/hemia/billing`; configurar `SECRETS_ENVIRONMENT`
para cada entorno (`dev`, `qa`, `staging`, `prod`). Con el mount predeterminado,
`database/postgres` se resuelve como `kv-dev/internal/hemia/billing/database/postgres`.

Configurar en el entorno del proceso:

```dotenv
SECRETS_ENABLED=true
SECRETS_ENVIRONMENT=dev
SECRETS_CATEGORY=internal
SECRETS_OWNER=hemia
SECRETS_SYSTEM=billing
VAULT_BASE_URL=https://vault.example.com
VAULT_ROLE_ID=<AppRole de billing>
VAULT_SECRET_ID=<credencial AppRole>
SECRETS_SSO_PATH=auth/sso
```

La ruta SSO predeterminada es `auth/sso`: con el scope de desarrollo se resuelve
como `kv-dev/internal/hemia/billing/auth/sso`. `SECRETS_SSO_PATH` permite sobrescribirla.
El AppRole debe poder leer los tres secretos KV v2 dentro del scope configurado.
Nunca poner las credenciales AppRole en variables `NEXT_PUBLIC_*` ni versionarlas.

## Contratos

Los secretos son objetos planos; `@hemia/secrets` extrae el contenido de KV v2.

| Ruta relativa | Campos requeridos |
| --- | --- |
| `database/postgres` | `db_host`, `db_port`, `db_username`, `db_password`, `db_database`, `db_logging` |
| `cache/redis` | `redis_host`, `redis_port`, `redis_password`, `redis_db` |
| `auth/sso` | `sso_issuer`, `sso_client_id`, `sso_audience`, `sso_redirect_uri`, `sso_frontend_url`, `access_api_url` |

PostgreSQL y Redis siguen el contrato de legal: puertos y `redis_db` son números,
`db_logging` es booleano y los otros campos son strings. Los passwords pueden
ser strings vacíos en desarrollo; Redis exige password no vacío en producción
para ambas fuentes. Los hosts, usuario y nombre de BD no pueden estar vacíos.

SSO acepta claves en minúsculas o mayúsculas (`sso_client_id` / `SSO_CLIENT_ID`),
pero no ambas para el mismo campo. Campos opcionales:

- `sso_client_secret`: configurar para clientes confidenciales.
- `sso_jwks_url`, `sso_authorization_url`, `sso_token_url`,
  `sso_revocation_url`, `sso_logout_url`: por defecto se derivan de `sso_issuer`.
- `sso_scope`: `openid profile email offline_access billing.access`.
- `sso_cookie_name`: `billing_session`.
- `sso_session_ttl_seconds`: `604800`.
- `sso_cookie_secure`: por defecto verdadero en producción; no admite falso en producción.
- `product_code`: únicamente `billing`.
- `access_jwks_uri`: derivado de `access_api_url`.
- `access_audience`: `access-api`.

El callback es `/auth/callback`, sin `/api/v1`. Los valores SSO de Vault son la
fuente de configuración en ese modo; los campos opcionales usan los defaults
indicados, no secretos parciales del entorno.

## Arranque y validación

Sin Vault (`SECRETS_ENABLED=false`) se mantiene la configuración por entorno,
incluido `REDIS_PORT` (6379 por defecto), y no se crea un cliente Vault.
Con Vault, cada factory espera y valida su secreto antes de crear el cliente.
Un secreto faltante, inválido o inaccesible detiene el arranque, sin fallback
silencioso a credenciales locales. No se registran valores secretos en los errores
de validación.

No se exige duplicar `DB_*`, `REDIS_*` o `SSO_*` en `.env` con Vault habilitado.
Las otras configuraciones siguen en el entorno: `NODE_ENV`, CORS, puerto y,
en producción, `AUTH_JWKS_URI`, `AUTH_AUDIENCE` y al menos uno de
`AUTH_REQUIRED_ISSUER` o `AUTH_ISSUER_URL` para la autenticación bearer existente.
`AUTH_REQUIRED_ISSUER` tiene precedencia. Esta configuración permanece separada
de SSO; la audiencia de integraciones no se infiere de la audiencia del login.

Con Vault activo, la validación inicial ignora los valores `DB_*`, `REDIS_*`,
`SSO_*` y `ACCESS_*` del entorno, aunque estén vacíos o mal formados. No se
construye SSO desde ese entorno antes de leer Vault. PostgreSQL, Redis y SSO
validan los valores efectivos antes de crear sus clientes. La política de
cookies seguras de producción se aplica a ambas fuentes.

Las credenciales se resuelven al arrancar; reiniciar la API tras rotarlas.
La configuración CLI de TypeORM (`data-source.ts`) sigue usando variables de
entorno; esta integración cubre el runtime NestJS y no ejecuta migraciones.

Validación local: `bun run --cwd apps/api build` y
`bun run --cwd apps/api test --runInBand`. Las pruebas usan secretos simulados,
sin conectarse al Vault real.
