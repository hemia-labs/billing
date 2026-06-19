import { registerAs } from '@nestjs/config';

const PAYPAL_BASE_URLS = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

export default registerAs('paypal', () => {
  const environment = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';

  return {
    environment,
    baseUrl: process.env.PAYPAL_API_BASE_URL ?? PAYPAL_BASE_URLS[environment],
    clientId: process.env.PAYPAL_CLIENT_ID ?? '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? '',
  };
});
