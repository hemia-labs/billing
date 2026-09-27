import { SetMetadata } from '@nestjs/common';
export type BillingResourceKind =
  | 'subscriptions'
  | 'checkout_sessions'
  | 'licenses'
  | 'invoices'
  | 'audit_logs'
  | 'subscription_addons'
  | 'webhook_events';
export const BillingResource = (kind: BillingResourceKind, parameter = 'id') =>
  SetMetadata('billing:resource', { kind, parameter });
