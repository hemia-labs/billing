---
"api": minor
---

Add public Payments connection discovery and authenticated snapshot resolution for the verified OAuth machine client. Reuse `billing.integration.catalog.read`, enforce the current client policy and active authorized product, and return only versioned configuration without secrets.

Persist Console-published connections in the existing service-client policy, preserving omitted snapshots and merging updates under the existing transaction lock. No database migration or seed is required. Discovery derives its public Billing origin from the configured SSO redirect URI rather than request headers.
