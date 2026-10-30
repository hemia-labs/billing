---
"@hemia/payments": minor
---

Add `resolvePaymentsConnection` to load a Console-published connection once during backend initialization using the Billing origin, connection code, and existing OAuth client credentials. Resolve discovery metadata and fetch only the authenticated client's secret-free configuration through `@hemia/auth`, with contract, destination, redirect, timeout, and payload validation.

Keep explicit `PAYMENTS_CONNECTION` initialization compatible. Make receiver client identifiers optional so Legal-only callbacks do not require license or Console receivers; callbacks still fail closed when their required client is missing.

The resolver requires Billing's `hemia.payments.connections.v1` endpoints under `/api/v1`, a published snapshot, and the existing `billing.integration.catalog.read` permission. Run the updated Billing and Console locally before switching a consumer to the four-variable delivery. Other connection profiles keep explicit configuration.
