import { SetMetadata } from '@nestjs/common';
import type { BillingServiceResource } from '../repositories/billing-resource-context.repository';

export type { BillingServiceResource } from '../repositories/billing-resource-context.repository';
export type BillingServiceAccessRule =
  | 'catalog'
  | 'catalog-target'
  | 'invoice-list'
  | {
      product: string;
      organization?: string;
      source: 'body' | 'query' | 'params';
    }
  | {
      resource: BillingServiceResource;
      parameter?: string;
      source?: 'body' | 'params';
    };

export const BILLING_SERVICE_ACCESS = 'billing:service-access';
export const BillingServiceAccess = (rule: BillingServiceAccessRule) =>
  SetMetadata(BILLING_SERVICE_ACCESS, rule);
