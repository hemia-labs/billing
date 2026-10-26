---
"@hemia/payments": minor
---

Add an explicit read-only verifyCompatibility preflight requiring Billing >=1.0.1 and <2.0.0. Verify the deployed server contract before Nest reports integration readiness, and document server-first consumer upgrades independently of npm publication.
