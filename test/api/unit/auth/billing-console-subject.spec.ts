import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BillingConsoleAuthGuard } from '../../../../apps/api/src/common/guards/billing-console-auth.guard';
import type { AuthenticatedRequest } from '../../../../apps/api/src/common/types/authenticated-request.type';

it('preserves the authenticated SSO subject before replacing the user with the Billing principal', async () => {
  const req = {} as AuthenticatedRequest;
  const context = {
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  const sso = {
    canActivate: jest.fn().mockImplementation(() => {
      req.user = { sub: 'sso-subject', internalUserId: 'billing-subject' };
      return Promise.resolve(true);
    }),
  };
  const session = {
    resolve: jest.fn().mockResolvedValue({
      organizationId: 'org',
      permissions: ['billing.webhooks.read'],
    }),
  };
  const guard = new BillingConsoleAuthGuard(
    sso as never,
    new Reflector(),
    session as never,
  );
  await expect(guard.canActivate(context)).resolves.toBe(true);
  expect(req.ssoSubject).toBe('sso-subject');
  expect(req.principal?.sub).toBe('billing-subject');
});
