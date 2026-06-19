import { registerAs } from '@nestjs/config';

export default registerAs('hemiaLegal', () => ({
  baseUrl: process.env.HEMIA_LEGAL_BASE_URL ?? '',
  apiKey: process.env.HEMIA_LEGAL_API_KEY ?? '',
}));
