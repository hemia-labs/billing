import { registerAs } from '@nestjs/config';
export default registerAs('eventBus', () => ({
  enabled:
    process.env.NODE_ENV === 'production' ||
    process.env.EVENT_BUS_ENABLED === 'true',
  url: process.env.AMQP_URL,
  prefetch: Number(process.env.EVENT_BUS_PREFETCH ?? 10),
}));
