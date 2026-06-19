import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingInternalApiKeyGuard } from 'src/common/guards/billing-internal-api-key.guard';

const createContext = (apiKey?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name === 'x-billing-internal-api-key' ? apiKey : undefined,
      }),
    }),
  }) as ExecutionContext;

describe('BillingInternalApiKeyGuard', () => {
  it('allows valid API key', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'app.billingInternalApiKey'
          ? 'x'.repeat(32)
          : key === 'auth.legacyApiKeyEnabled',
      ),
    } as unknown as ConfigService;
    const guard = new BillingInternalApiKeyGuard(config);

    expect(guard.canActivate(createContext('x'.repeat(32)))).toBe(true);
  });

  it('rejects missing API key', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'app.billingInternalApiKey'
          ? 'x'.repeat(32)
          : key === 'auth.legacyApiKeyEnabled',
      ),
    } as unknown as ConfigService;
    const guard = new BillingInternalApiKeyGuard(config);

    expect(() => guard.canActivate(createContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects wrong API key', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'app.billingInternalApiKey'
          ? 'x'.repeat(32)
          : key === 'auth.legacyApiKeyEnabled',
      ),
    } as unknown as ConfigService;
    const guard = new BillingInternalApiKeyGuard(config);

    expect(() => guard.canActivate(createContext('wrong'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when legacy API key auth is disabled', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'app.billingInternalApiKey'
          ? 'x'.repeat(32)
          : key === 'auth.legacyApiKeyEnabled'
            ? false
            : undefined,
      ),
    } as unknown as ConfigService;
    const guard = new BillingInternalApiKeyGuard(config);

    expect(() => guard.canActivate(createContext('anything'))).toThrow(
      UnauthorizedException,
    );
  });
});
