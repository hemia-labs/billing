import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class PaypalConnectionCrypto {
  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return this.key() !== null;
  }

  private key(): Buffer | null {
    const value = this.config.get<string>(
      'paypalConnections.encryptionKey',
      '',
    );
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
    const key = Buffer.from(value, 'base64');
    return key.length === 32 ? key : null;
  }
  private requiredKey() {
    const key = this.key();
    if (!key)
      throw new ServiceUnavailableException(
        'PayPal connection encryption is not configured',
      );
    return key;
  }
  encrypt(secret: string, connectionId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.requiredKey(), iv);
    cipher.setAAD(Buffer.from(connectionId));
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }
  decrypt(value: string, connectionId: string): string {
    const key = this.requiredKey();
    try {
      const [version, rawIv, rawTag, rawCiphertext, extra] = value.split('.');
      if (
        version !== 'v1' ||
        extra !== undefined ||
        !rawIv ||
        !rawTag ||
        !rawCiphertext
      )
        throw new Error();
      const iv = Buffer.from(rawIv, 'base64url'),
        tag = Buffer.from(rawTag, 'base64url');
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(connectionId));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(rawCiphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException(
        'PayPal connection credentials are unavailable',
      );
    }
  }
}
