---
"api": minor
---

Expose Payments connection discovery and resolution v2 with the independent `billing.integration.connections.read` machine permission. Resolve only the authenticated client's published snapshot for an active authorized product. Catalog, checkout and license operations retain their existing permissions. Keep the published v1 contract available for Payments 0.11.0 clients. No Billing database migration is required.
