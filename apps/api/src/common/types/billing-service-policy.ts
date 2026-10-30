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

const identifier = z.string().min(1).max(120).regex(/^\S+$/);
const connectionReturnUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (process.env.NODE_ENV !== 'production' &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  }, 'Connection URLs must use HTTPS or development loopback');
const connectionUrl = connectionReturnUrl.refine(
  (value) => URL.canParse(value) && !new URL(value).search,
  'Service URLs must not include query parameters',
);
export const billingConnectionConfiguration = z
  .object({
    issuer: connectionUrl,
    tokenUrl: connectionUrl,
    clientId: identifier,
    baseUrl: connectionUrl,
    resource: connectionUrl,
    audience: identifier,
    productCode: identifier.max(80),
    receiver: z
      .object({
        audience: identifier,
        billingClientId: identifier.optional(),
        consoleClientId: identifier.optional(),
      })
      .strict()
      .optional(),
    legal: z
      .object({
        baseUrl: connectionUrl,
        resource: connectionUrl,
        audience: identifier,
        verificationClientId: identifier,
      })
      .strict()
      .refine(
        (value) =>
          URL.canParse(value.baseUrl) &&
          URL.canParse(value.resource) &&
          new URL(value.baseUrl).origin === new URL(value.resource).origin,
        'Legal base URL and resource must share an origin',
      )
      .optional(),
    successUrl: connectionReturnUrl.optional(),
    cancelUrl: connectionReturnUrl.optional(),
    allowHttpLoopback: z.boolean().optional(),
  })
  .strict()
  .refine((value) => {
    const urls = [
      value.issuer,
      value.tokenUrl,
      value.baseUrl,
      value.resource,
      value.successUrl,
      value.cancelUrl,
      value.legal?.baseUrl,
      value.legal?.resource,
    ].filter(Boolean) as string[];
    return (
      !urls.some((url) => url.startsWith('http:')) ||
      value.allowHttpLoopback === true
    );
  }, 'HTTP loopback requires explicit development configuration');
export const billingConnectionCode = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{1,79}$/)
  .refine((code) => code !== 'discovery');
const connections = z
  .record(
    billingConnectionCode,
    z
      .object({
        version: z.literal(1),
        configuration: billingConnectionConfiguration,
      })
      .strict(),
  )
  .refine(
    (value) =>
      Object.keys(value).length <= 100 &&
      JSON.stringify(value).length <= 128000,
  );
export type BillingPublishedConnections = z.infer<typeof connections>;

const base = z.object({
  enabled: z.boolean().default(true),
  products: z.array(z.string().trim().min(1).max(80)).min(1),
  allowSharedCheckouts: z.boolean().default(false),
  allowedReturnOrigins: z.array(returnOrigin).default([]),
  connections: connections.optional(),
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
