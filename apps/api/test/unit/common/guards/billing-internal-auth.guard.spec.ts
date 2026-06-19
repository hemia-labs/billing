import { ExecutionContext } from '@nestjs/common';
import { BillingInternalApiKeyGuard } from 'src/common/guards/billing-internal-api-key.guard';
import { BillingInternalAuthGuard } from 'src/common/guards/billing-internal-auth.guard';
import { SsoBearerGuard } from 'src/common/guards/sso-bearer.guard';

const createContext = (headers: Record<string, string | undefined>) => {
  const request = {
    header: (name: string) => headers[name],
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

describe('BillingInternalAuthGuard', () => {
  it('uses SSO bearer guard when bearer token is present', async () => {
    const { context } = createContext({ authorization: 'Bearer token' });
    const ssoBearerGuard = {
      canActivate: jest.fn().mockResolvedValue(true),
    } as unknown as SsoBearerGuard;
    const apiKeyGuard = {
      canActivate: jest.fn(),
    } as unknown as BillingInternalApiKeyGuard;
    const guard = new BillingInternalAuthGuard(ssoBearerGuard, apiKeyGuard);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(ssoBearerGuard.canActivate).toHaveBeenCalledWith(context);
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled();
  });

  it('uses legacy API key and grants billing wildcard scope when no bearer token exists', async () => {
    const { context, request } = createContext({});
    const ssoBearerGuard = {
      canActivate: jest.fn(),
    } as unknown as SsoBearerGuard;
    const apiKeyGuard = {
      canActivate: jest.fn(() => true),
    } as unknown as BillingInternalApiKeyGuard;
    const guard = new BillingInternalAuthGuard(ssoBearerGuard, apiKeyGuard);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toHaveProperty('principal', {
      sub: 'legacy-api-key',
      scopes: ['billing.*'],
      isMachine: true,
    });
  });
});
