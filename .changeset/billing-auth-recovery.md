---
"api": patch
"web": patch
---

Evita el ciclo de login cuando Access no está disponible, muestra recuperación manual con estados de error diferenciados y conserva HTTP 503 durante la renovación de sesión. Agrega el comando local `dev:stack` para iniciar Identity, Access y Billing con comprobaciones de disponibilidad.

Registra las entidades TypeORM desde los módulos de Nest y comprueba metadatos y disponibilidad PostgreSQL en la readiness de Billing, evitando marcar como sana una API sin catálogo operativo.
