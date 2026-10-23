# Detalle y descarga de webhooks

`GET /api/v1/billing/console/webhooks/:id` devuelve el resumen operativo validado
(`summary`), las referencias y el estado. Nunca incluye `payloadJson` ni el token
de bloqueo del worker.

`GET /api/v1/billing/console/webhooks/:id/manual-retries?page=1&limit=10` devuelve
`{items,total,page,limit}`. Cada registro contiene fecha, identificador del usuario,
motivo y número de intento dentro de la ventana de 15 minutos. Ese número puede
repetirse; no es un contador histórico consecutivo. Ambos GET requieren
`billing.webhooks.read` y acceso a la organización del webhook.

## Descargar el JSON original

`POST /api/v1/billing/console/webhooks/:id/payload/download`

```json
{"password":"contraseña actual de Hemia","reason":"Motivo de la investigación"}
```

- Requiere sesión humana, `billing.webhooks.read`, `billing.webhooks.retry` y
  acceso al webhook; no admite credenciales de máquina.
- Contraseña obligatoria de hasta 1024 caracteres; motivo de 1 a 250 caracteres.
- Billing confirma la contraseña en Identity utilizando el access token de la
  sesión, que permanece en el servidor. Comprueba que la respuesta corresponde
  al mismo sujeto y al propósito `webhook_payload_download`.
- Identity limita a cinco verificaciones (correctas o fallidas) por usuario cada
  15 minutos, compartidas entre instancias y clientes. No crea otra sesión.
- La auditoría `billing.webhook.payload_download` debe guardarse antes de enviar
  el archivo; registra usuario, recurso, organización y `downloadReason`, nunca
  contraseña ni payload. Registra autorización/emisión, no confirma guardado del
  archivo en el equipo del usuario.
- Respuesta 200: archivo `webhook-<id>.json`, `Content-Disposition: attachment`,
  `Cache-Control: private, no-store`. No existe descarga mediante GET.
- Errores: 400 entrada inválida; 401 sesión inválida; 403 contraseña/permisos/alcance
  no válidos; 404 webhook inexistente; 429 límite de verificaciones; 503 Identity
  no disponible o transporte inseguro. No se propagan cuerpos de error de Identity.

## Requisito de Identity y transporte

Publicar primero el endpoint `POST /api/v1/auth/reauthenticate` implementado en
el repositorio `identity-access/identity`, y después Billing. El contrato es:

```json
{"password":"contraseña actual","purpose":"webhook_payload_download"}
```

Autenticación: `Authorization: Bearer <access token OAuth del usuario>`, con
scopes `openid billing.access`. Respuesta:

```json
{"verified":true,"subject":"id del usuario","purpose":"webhook_payload_download"}
```

El navegador y Billing rechazan HTTP remoto y redirecciones al confirmar la
contraseña. Se permite HTTP loopback únicamente para desarrollo local; en
producción deben configurarse `NEXT_PUBLIC_API_URL` y `SSO_ISSUER` con HTTPS.
La página de descarga también debe ejecutarse en un contexto seguro.

No requiere migraciones ni cambios del catálogo de permisos. Hasta publicar
Identity, la descarga falla de forma cerrada; no se sustituye por validar una
contraseña cualquiera o por reutilizar la sesión como prueba de contraseña.
