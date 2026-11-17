# Recuperación de sesión y arranque local

Billing necesita tanto Identity (autenticación) como Access (autorización).
Si Access no responde durante el callback, `@hemia/auth` vuelve al frontend con
`error=access_unavailable` y no crea una sesión. Un `401` posterior es correcto:
la sesión todavía no existe. Volver a lanzar automáticamente OAuth desde esa
página repetiría el callback fallido indefinidamente.

## Comportamiento de recuperación

El frontend reconoce únicamente los errores de callback cerrados
`access_unavailable`, `access_denied` y `auth_failed`. Cuando no puede recuperar
una sesión, estos estados detienen el login automático y ofrecen una acción
manual. Los códigos desconocidos no se muestran como mensajes crudos.
Una sesión válida puede recuperar la aplicación aunque quede una marca antigua
en la URL; sólo se limpia el parámetro de error reconocido. La ruta, los otros
parámetros y el fragmento se conservan.

Una sesión ausente sin error previo puede iniciar el login normal. Un `503`,
error de red o espera agotada muestra un fallo recuperable del servicio, sin
iniciar OAuth automáticamente. El retorno del reintento se limita al origen de
Billing y elimina únicamente el error de callback reconocido.

En `/auth/session`, el backend conserva `401` para sesión ausente/inválida,
`403` para acceso denegado, `409` para conflicto de contexto y `503` para Access
no disponible, incluso si falla durante la renovación de sesión. Las respuestas
no incluyen tokens, cookies, errores internos ni detalles del proveedor.

## Arranque local

Desde la raíz de Billing:

```bash
bun run dev:stack
```

El comando comprueba/inicia en orden Identity API, Identity web, Access API,
Billing API y Billing web. Antes de continuar valida la respuesta de salud,
el issuer OIDC, las claves públicas de Access o la respuesta propia de cada
aplicación, según corresponda. Un puerto abierto por sí solo no acredita que
la dependencia esté lista.

Se esperan los checkouts vecinos `../identity-access/identity` y
`../identity-access/access`. Para otras ubicaciones:

```bash
IDENTITY_ROOT=/ruta/identity ACCESS_ROOT=/ruta/access bun run dev:stack
```

Los entornos locales deben utilizar estos puertos:

| Servicio | Puerto | Comprobación |
| --- | --- | --- |
| Identity API | 4000 | `/api/v1/health/ready` y discovery OIDC |
| Identity web | 5173 | HTML Hemia ID |
| Access API | 3019 | `/health/ready` y JWKS |
| Billing API | 3015 | `/api/v1/health/ready` y `/api/v1` |
| Billing web | 5175 | HTML del resumen operativo |

PostgreSQL, Redis, dependencias y esquemas deben estar preparados. El comando
no cambia configuración, credenciales ni datos; no ejecuta instalaciones,
migraciones ni seeds. Si la salud indica migraciones pendientes, revisarlas y
aplicarlas explícitamente según las reglas del servicio correspondiente.

Un servicio sano se reutiliza. Si un puerto ocupado devuelve una respuesta
incorrecta o no saludable, el comando falla sin detener su propietario. Los
procesos creados por el comando se mantienen supervisados en la terminal; al
cerrar con Ctrl+C o fallar un proceso creado, se cierran sólo esos procesos.
Las instancias preexistentes permanecen activas. Si todos los servicios ya
estaban sanos, el comando sólo informa su estado y termina.

Los logs de procesos nuevos van a un directorio temporal privado
`billing-dev-stack-*`, con archivos de modo `600`. No se imprimen sus entornos.
Para comprobar el conjunto sin iniciar ningún proceso:

```bash
bun run dev:stack --check
```

La readiness de Billing comprueba que TypeORM tenga registradas las entidades
que usa la aplicación y que PostgreSQL responda a una consulta de lectura.
Devuelve `503` sin detalles internos si alguna comprobación falla; el saludo
público de `/api/v1` por sí solo no acredita que el catálogo funcione. El runtime
registra las clases de entidades de los módulos de Nest, sin buscar archivos
de entidades durante el arranque. La configuración CLI de migraciones permanece
independiente.

Estas comprobaciones acreditan disponibilidad al arrancar, no autorización de
un usuario ni un monitor permanente de dependencias. La protección del frontend
permite recuperarse manualmente si Access se cae después del arranque.

## Validación

```bash
bun run test:dev-stack
bun run --cwd apps/web test
bun run --cwd apps/api test --runInBand auth-session-availability-http
```

El runner del arranque usa procesos HTTP y directorios temporales desechables:
verifica reutilización, respuesta de salud/issuer correctos, puertos ocupados,
dependencias fallidas y cierre sin detener procesos ajenos. No contacta bases
reales ni proveedores de pagos.

Comprobación manual en Opera: una ventana privada sin sesión abrió
`?error=access_unavailable`, permaneció en la pantalla de recuperación y sólo
navegó a Identity al pulsar el botón. Con una sesión vigente, se eliminó el error
antiguo conservando los otros parámetros y el fragmento. Tras el reinicio
controlado, la pantalla de PayPal consultó y mostró la conexión Medsync existente.
No se modificaron conexiones ni se realizaron pagos durante esta comprobación.
