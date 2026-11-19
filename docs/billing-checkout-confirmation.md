# Optional checkout confirmation in license snapshots

`GET /api/v1/billing/integrations/v1/snapshots` and the
`billing.license.updated` delivery can include
`license.billing.checkoutConfirmation`. Existing snapshot permissions and tenant
policy remain unchanged. This optional extension is carried in the existing
`billing` record; it does not require a new Payments SDK version.

```typescript
{
  status: 'completed';
  organizationId: string;
  productCode: string;
  subscriptionId: string;
  paymentId: string;
  userId: string;
  planCode: string;
  planPriceCode: string;
  planName: null;
  recurringAmount: string;
  currency: string;
  billingInterval: 'month' | 'year';
  billingIntervalCount: number;
  paidAmount: string;
  paidAt: string; // ISO 8601 UTC
  provider: 'paypal';
  nextBillingAt: string | null; // ISO 8601 UTC
}
```

The confirmation is present only for the actively licensed, active subscription
with an owned original checkout and a positive initial PayPal sale recorded as
`paid` internally. Its original `PAYMENT.SALE.COMPLETED` event must be verified,
processed, associated with that provider subscription and sale, and use the same
pinned PayPal connection throughout checkout, payment, subscription and event.
The payment must also carry durable initial-checkout evidence recorded by the
payment processor from its authenticated PayPal subscription observation: matching
provider subscription, exactly one regular cycle with sequence 1 and one completed
cycle, no trial cycle, and last-payment time equal to the sale time after timestamp
normalization. This evidence is preserved on replays even after current cycle
counters advance. Historical payments without it are omitted; the first locally
observed payment alone does not establish an initial checkout payment.

The first payment is selected before checking its status. Later recurring
payments cannot replace an initial refunded, reversed, failed or pending payment.
Any recorded refund, including a partial refund, excludes the confirmation.

Buyer identity comes from the checkout. Price, currency, billing interval and
count come from its frozen price/version relation, with the same plan and price
still associated with the subscription. Current catalog prices and names are
never substituted. `planName` is null because existing checkouts did not freeze
the plan name. `nextBillingAt` is the current subscription's known next billing
time, not a promise that another payment has occurred.

Activation without payment, grace or inactive access, addon sales, plan-change
payments, scheduled renewal contracts and unreliable historical data do not
produce this field. Omitting it does not change license access.

Snapshots and webhook deliveries repeat. A consumer sending one purchase welcome
email must persist deduplication by `subscriptionId`; neither each new snapshot
revision nor each monthly payment represents a new purchase welcome. Consumers
must also validate matching tenant, product, subscription, plan and price against
the active license, and derive recipient contact details from their own trusted
user store using `userId`. This record exposes no email address, approval URL,
provider resource ID, connection ID or credentials. Billing does not send email.

Recording a completed sale explicitly enqueues a fresh license delivery in the same
transaction, including when activation already wrote identical subscription/license
fields. Sale reversals and recorded partial or full refunds also enqueue a fresh
snapshot so the optional confirmation can be removed without waiting for another
license change. This uses the existing delivery queue and database function.
