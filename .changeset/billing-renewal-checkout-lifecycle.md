---
"api": minor
---

Add subscription renewal resumption and future renewal plan changes through durable, idempotent payment attempts. Expose pending renewal approval and checkout state, preserve paid access until the current period ends, and reconcile PayPal subscription payments, cancellations and refunds with the effective billing period.

Recover pending checkout attempts without duplicating provider subscriptions, exclude abandoned checkouts from the current subscription, and retain the initiating organization and client when resuming approval.
