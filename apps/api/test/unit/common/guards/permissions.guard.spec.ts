import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from 'src/common/guards/permissions.guard';

const createGuard = (requiredPermissions: string[]) =>
  new PermissionsGuard({
    getAllAndOverride: jest.fn(() => requiredPermissions),
  } as unknown as Reflector);

const createContext = (permissions: string[]) =>
  ({
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          sub: 'user-id',
          scopes: permissions,
          isMachine: false,
        },
      }),
    }),
  }) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  it('allows exact permission', () => {
    const guard = createGuard(['billing.invoices.manage']);

    expect(guard.canActivate(createContext(['billing.invoices.manage']))).toBe(
      true,
    );
  });

  it('allows resource wildcard permission', () => {
    const guard = createGuard(['billing.invoices.manage']);

    expect(guard.canActivate(createContext(['billing.*']))).toBe(true);
  });

  it('allows global wildcard permission', () => {
    const guard = createGuard(['billing.invoices.manage']);

    expect(guard.canActivate(createContext(['*.*']))).toBe(true);
  });

  it('rejects missing permission', () => {
    const guard = createGuard(['billing.invoices.manage']);

    expect(() =>
      guard.canActivate(createContext(['billing.licenses.read'])),
    ).toThrow(ForbiddenException);
  });
});
