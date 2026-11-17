import { ConfigService } from '@nestjs/config';
import { PaypalConnectionCrypto } from '../../../../apps/api/src/modules/paypal-connections/paypal-connection.crypto';

const config = (key = Buffer.alloc(32, 7).toString('base64')) =>
  new ConfigService({ paypalConnections: { encryptionKey: key } });
describe('product PayPal secret encryption', () => {
  it('encrypts with authenticated randomized ciphertext and binds it to the connection', () => {
    const crypto = new PaypalConnectionCrypto(config());
    const secret = 'secret-with-sensitive-literal';
    const first = crypto.encrypt(secret, 'app-a'),
      second = crypto.encrypt(secret, 'app-a');
    expect(first).not.toContain(secret);
    expect(second).not.toBe(first);
    expect(crypto.decrypt(first, 'app-a')).toBe(secret);
    expect(() => crypto.decrypt(first, 'app-b')).toThrow(
      'credentials are unavailable',
    );
    expect(() => crypto.decrypt(first.slice(0, -4) + 'aaaa', 'app-a')).toThrow(
      'credentials are unavailable',
    );
  });
  it.each(['', 'not-a-key', Buffer.alloc(16).toString('base64')])(
    'fails closed without a valid configured key (%s)',
    (key) => {
      const crypto = new PaypalConnectionCrypto(config(key));
      expect(crypto.configured()).toBe(false);
      expect(() => crypto.encrypt('secret', 'app')).toThrow(
        'encryption is not configured',
      );
    },
  );
  it('never leaks ciphertext or secret when decryption fails with another key', () => {
    const ciphertext = new PaypalConnectionCrypto(config()).encrypt(
      'old-secret',
      'app',
    );
    const crypto = new PaypalConnectionCrypto(
      config(Buffer.alloc(32, 8).toString('base64')),
    );
    expect(() => crypto.decrypt(ciphertext, 'app')).toThrow(
      'PayPal connection credentials are unavailable',
    );
  });
});
