import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'crypto';
import { sign } from 'jsonwebtoken';
import { SsoBearerGuard } from 'src/common/guards/sso-bearer.guard';

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' });
const publicJwk = keyPair.publicKey.export({ format: 'jwk' });

const createConfig = () =>
  ({
    get: jest.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        'auth.audience': 'billing-api',
        'auth.issuerUrl': 'https://identity.example.com',
        'auth.jwksUri': 'https://identity.example.com/.well-known/jwks.json',
        'auth.requiredIssuer': 'https://identity.example.com',
      };

      return values[key];
    }),
  }) as unknown as ConfigService;

const createContext = (authorization?: string) => {
  const request = {
    header: (name: string) =>
      name === 'authorization' ? authorization : undefined,
  };

  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext,
    request,
  };
};

const signToken = (payload: Record<string, unknown>, expiresIn = '1h') =>
  sign(payload, privateKey, {
    algorithm: 'RS256',
    audience: 'billing-api',
    expiresIn,
    header: { kid: 'test-key' },
    issuer: 'https://identity.example.com',
  });

describe('SsoBearerGuard', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        keys: [{ ...publicJwk, kid: 'test-key' }],
      }),
      ok: true,
    });
  });

  it('attaches principal from valid RS256 bearer token with scope string', async () => {
    const token = signToken({
      sub: 'user-id',
      scope: 'billing.invoices.manage billing.licenses.read',
      organizationId: 'organization-id',
      email: 'user@example.com',
    });
    const { context, request } = createContext(`Bearer ${token}`);
    const guard = new SsoBearerGuard(createConfig());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toHaveProperty('principal', {
      sub: 'user-id',
      scopes: ['billing.invoices.manage', 'billing.licenses.read'],
      organizationId: 'organization-id',
      email: 'user@example.com',
      clientId: undefined,
      isMachine: false,
    });
  });

  it('accepts scopes array and machine client claims', async () => {
    const token = signToken({
      sub: 'client-sub',
      scopes: ['billing.*'],
      client_id: 'billing-worker',
      grant_type: 'client_credentials',
    });
    const { context, request } = createContext(`Bearer ${token}`);
    const guard = new SsoBearerGuard(createConfig());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toHaveProperty(
      'principal',
      expect.objectContaining({
        clientId: 'billing-worker',
        isMachine: true,
        scopes: ['billing.*'],
      }),
    );
  });

  it('rejects missing bearer token', async () => {
    const { context } = createContext();
    const guard = new SsoBearerGuard(createConfig());

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects invalid signature', async () => {
    const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otherPrivateKey = otherPair.privateKey.export({
      format: 'pem',
      type: 'pkcs8',
    });
    const token = sign(
      { sub: 'user-id', scope: 'billing.*' },
      otherPrivateKey,
      {
        algorithm: 'RS256',
        audience: 'billing-api',
        header: { kid: 'test-key' },
        issuer: 'https://identity.example.com',
      },
    );
    const { context } = createContext(`Bearer ${token}`);
    const guard = new SsoBearerGuard(createConfig());

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects wrong issuer', async () => {
    const token = sign({ sub: 'user-id', scope: 'billing.*' }, privateKey, {
      algorithm: 'RS256',
      audience: 'billing-api',
      header: { kid: 'test-key' },
      issuer: 'https://other.example.com',
    });
    const { context } = createContext(`Bearer ${token}`);
    const guard = new SsoBearerGuard(createConfig());

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects wrong audience', async () => {
    const token = sign({ sub: 'user-id', scope: 'billing.*' }, privateKey, {
      algorithm: 'RS256',
      audience: 'other-api',
      header: { kid: 'test-key' },
      issuer: 'https://identity.example.com',
    });
    const { context } = createContext(`Bearer ${token}`);
    const guard = new SsoBearerGuard(createConfig());

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects expired token', async () => {
    const token = signToken({ sub: 'user-id', scope: 'billing.*' }, '-1s');
    const { context } = createContext(`Bearer ${token}`);
    const guard = new SsoBearerGuard(createConfig());

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
