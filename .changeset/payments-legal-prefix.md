---
"@hemia/payments": patch
---

Preserve the configured Legal base URL prefix for prepare and accept requests by
using MachineClient.request. Reuse the client's destination restrictions, OAuth,
timeout, redirect and cookie handling while retaining existing Legal errors.
