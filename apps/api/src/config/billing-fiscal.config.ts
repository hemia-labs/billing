import { registerAs } from '@nestjs/config';

export default registerAs('billingFiscal', () => ({
  provider: process.env.BILLING_FISCAL_PROVIDER ?? 'noop',
  apiBaseUrl: process.env.BILLING_FISCAL_API_BASE_URL ?? '',
  apiKey: process.env.BILLING_FISCAL_API_KEY ?? '',
  storageEndpoint: process.env.BILLING_FISCAL_STORAGE_ENDPOINT ?? '',
  storageBucket: process.env.BILLING_FISCAL_STORAGE_BUCKET ?? '',
  storageAccessKeyId: process.env.BILLING_FISCAL_STORAGE_ACCESS_KEY_ID ?? '',
  storageSecretAccessKey:
    process.env.BILLING_FISCAL_STORAGE_SECRET_ACCESS_KEY ?? '',
}));
