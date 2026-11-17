import { registerAs } from '@nestjs/config';
export default registerAs('paypalConnections', () => ({
  encryptionKey: process.env.PAYPAL_CONNECTION_ENCRYPTION_KEY ?? '',
}));
