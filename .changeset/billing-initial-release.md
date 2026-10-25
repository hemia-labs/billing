---
"api": major
"web": major
---

Primera release de Billing con CI, imagenes privadas, tags billing-vX.Y.Z, notas de Changesets y despliegue automatico con verificacion de migraciones.

Permite arrancar en produccion con facturacion fiscal explicitamente deshabilitada mediante BILLING_FISCAL_PROVIDER=disabled; rechaza emision y cancelacion antes de reservar operaciones y nunca simula resultados fiscales.
