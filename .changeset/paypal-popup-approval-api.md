---
"api": patch
---

Proyecta en el intento autorizado la configuración pública de la conexión PayPal fijada y el ID de la suscripción ya creada. Reutiliza el mismo intento idempotente, omite secretos, revisiones y prorrateos, y conserva la redirección cuando la ventana no está disponible. La aprobación del navegador no activa el plan; sigue dependiendo del webhook.

Al confirmar el receipt listo, despierta el outbox existente en la misma transacción para que un checkout lento pueda continuarse mediante un único GET disparado por webhook, sin polling. El snapshot no incorpora datos del comprador ni nuevos campos.
