import { registerAs } from '@nestjs/config';

const parseCorsOrigins = (value?: string): string[] =>
  (value ?? 'http://localhost:5175,http://localhost:3015')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export default registerAs('app', () => ({
  port: Number(process.env.PORT) || 3015,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  globalPrefix: process.env.APP_GLOBAL_PREFIX ?? 'api/v1',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  billingInternalApiKey: process.env.BILLING_INTERNAL_API_KEY ?? '',
}));
