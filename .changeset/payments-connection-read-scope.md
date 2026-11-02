---
"@hemia/payments": minor
---

Resolve Console connections through the v2 configuration contract with `billing.integration.connections.read`, independent of catalog access. Keep the four-variable initialization API and explicit `PAYMENTS_CONNECTION` compatibility. Business operations still request their own permissions. Remote resolution requires Billing v2 connection endpoints and a connection configured with the new scope in Console.
