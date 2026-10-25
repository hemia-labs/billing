---
"@hemia/payments": minor
---

Centralize durable payment attempts in Billing and remove mandatory databases from Node and Nest consumers. Add optional authenticated subscription/license snapshot receivers and synchronization callbacks for product-owned MySQL or PostgreSQL copies. Export framework-free Legal operations and freshness-aware snapshot access. Existing consumers should deploy Billing's central attempt migration and endpoints before upgrading; local schema migration exports remain historical and are no longer required by the Nest module.
