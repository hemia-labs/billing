import { z } from 'zod';
import {
  isLocalCheckoutReturnUrl,
  parseCheckoutReturnUrl,
} from '../common/utils/checkout-return-url';

const returnOrigin = z
  .string()
  .trim()
  .refine((value) => {
    const url = parseCheckoutReturnUrl(value);
    return (
      url !== null &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' || isLocalCheckoutReturnUrl(url))
    );
  }, 'Return origins must be HTTPS origins or explicit HTTP loopback origins')
  .transform((value) => new URL(value).origin);

const base = z.object({
  enabled: z.boolean().default(true),
  products: z.array(z.string().trim().min(1).max(80)).min(1),
  allowSharedCheckouts: z.boolean().default(false),
  allowedReturnOrigins: z.array(returnOrigin).default([]),
});
const policy = z.discriminatedUnion('organizationScope', [
  base
    .extend({
      organizationScope: z.literal('all_for_allowed_products'),
    })
    .strict(),
  base
    .extend({
      organizationScope: z.literal('organizations'),
      organizationIds: z.array(z.uuid()).min(1),
    })
    .strict(),
]);
const registry = z.record(z.string().trim().min(1).max(120), policy);

export type BillingServiceClientPolicy = z.infer<typeof policy>;
export type BillingServiceClients = z.infer<typeof registry>;

export function parseBillingServiceClients(
  value: string,
): BillingServiceClients {
  try {
    return registry.parse(JSON.parse(value) as unknown);
  } catch {
    throw new Error(
      'BILLING_SERVICE_CLIENTS must contain valid service policies',
    );
  }
}
