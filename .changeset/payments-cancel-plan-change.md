---
"@hemia/payments": minor
---

Add buyer-bound cancellation of central payment attempts and expose cancellationRequested in plan-change state. Preserve approval recovery when a cancelled change requires restoring the existing subscription, with authorization checks before transport.
