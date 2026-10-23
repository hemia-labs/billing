# Pruebas de consumidores de pagos

La suite vigente verifica Node puro y Nest sin tablas obligatorias, y la copia opcional con MySQL/PostgreSQL. La persistencia e idempotencia centrales se verifican por separado en Billing.

Desde la raíz de Billing:

```sh
bun run --cwd packages/payments build
bash test/payments/integration/database-optional/verify.sh
bash test/api/integration/payment-attempts/central-payment-attempts.docker.sh
```

El antiguo comando `atlas/verify.sh` ejecuta la matriz vigente. Los fixtures que exigían una migración PostgreSQL en el producto fueron sustituidos por estos casos. Las bases son desechables; no se utilizan bases residentes ni se crean cobros PayPal.
