import { z } from 'zod';
import {
  isLocalCheckoutReturnUrl,
  parseCheckoutReturnUrl,
} from '../utils/checkout-return-url';

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
      // ValidationPipe materializes omitted optional DTO fields as undefined.
      organizationIds: z.undefined().optional(),
    })
    .strict(),
  base
    .extend({
      organizationScope: z.literal('organizations'),
      organizationIds: z.array(z.uuid()),
    })
    .strict(),
]);
export type BillingServiceClientPolicy = z.infer<typeof policy>;

export function parseBillingServicePolicy(
  value: unknown,
): BillingServiceClientPolicy {
  return policy.parse(value);
}
