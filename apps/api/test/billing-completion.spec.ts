import { BillingInternalAuthGuard } from '../src/common/guards/billing-internal-auth.guard';

describe('Billing machine authentication without API key fallback', () => {
  const fixture = (authorization: string | undefined, isMachine: boolean) => {
    const request = { header: () => authorization, principal: { isMachine } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) };
    const bearer = { canActivate: jest.fn().mockResolvedValue(true) };
    return {
      context,
      bearer,
      guard: new BillingInternalAuthGuard(
        bearer as never,
        { resolvePrincipal: jest.fn() } as never,
      ),
    };
  };
  it('requires a bearer even if callers previously supplied an API key', async () => {
    const f = fixture(undefined, true);
    await expect(f.guard.canActivate(f.context as never)).rejects.toThrow(
      'Service bearer token required',
    );
    expect(f.bearer.canActivate).not.toHaveBeenCalled();
  });
  it('rejects a human bearer for integrations', async () => {
    const f = fixture('Bearer human', false);
    await expect(f.guard.canActivate(f.context as never)).rejects.toThrow(
      'User credentials',
    );
  });
  it('accepts a validated machine bearer', async () => {
    const f = fixture('Bearer machine', true);
    await expect(f.guard.canActivate(f.context as never)).resolves.toBe(true);
    expect(f.bearer.canActivate).toHaveBeenCalledTimes(1);
  });
});
