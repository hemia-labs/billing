import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB) || 0,
}));
