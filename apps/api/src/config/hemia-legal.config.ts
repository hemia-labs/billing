import { registerAs } from '@nestjs/config';
export default registerAs('hemiaLegal', () => ({
  baseUrl: process.env.HEMIA_LEGAL_BASE_URL ?? '',
  tokenUrl: process.env.HEMIA_LEGAL_TOKEN_URL ?? '',
  clientId: process.env.HEMIA_LEGAL_CLIENT_ID ?? 'billing-legal-service',
  clientSecret: process.env.HEMIA_LEGAL_CLIENT_SECRET ?? '',
  identityIssuer: process.env.SSO_ISSUER ?? '',
  products: process.env.HEMIA_LEGAL_PRODUCTS ?? '{}',
}));
