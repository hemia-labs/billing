import { ForbiddenException, ConflictException } from '@nestjs/common';
import {
  permissionScope,
  validateBillingContext,
  permissionsForAuthorization,
  type BillingAssignment,
  type BillingAuthorization,
} from '../../../../apps/api/src/modules/auth/session/billing-console-permissions';
import { PermissionsGuard } from '../../../../apps/api/src/common/guards/permissions.guard';
import { BillingOperationsService } from '../../../../apps/api/src/modules/operations/billing-operations.service';
const uuid = (n: number) =>
  `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const grant = (
  role: string,
  type: string,
  targets?: string[],
): BillingAssignment => ({
  assignment_id: uuid(1),
  assignment_version: 1,
  role_code: role,
  scope: targets ? { type, organization_ids: targets } : { type },
  valid_from: 1,
  expires_at: null,
});
const authorization = (
  assignments: BillingAssignment[],
): BillingAuthorization => ({
  assignments,
  expiresAt: Math.floor(Date.now() / 1000) + 60,
});
const expected = {
  subject: 'ana',
  issuer: 'https://identity.test',
  identityReferenceId: uuid(2),
  organizationId: uuid(3),
  membershipId: uuid(4),
};
const claims = () => {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://access.test',
    aud: 'billing-api',
    sub: 'ana',
    identity_issuer: expected.issuer,
    identity_reference_id: uuid(2),
    organization_id: uuid(3),
    membership_id: uuid(4),
    product_code: 'billing',
    contract_version: 1,
    catalog_version: 1,
    context_version: 1,
    jti: uuid(5),
    iat: now,
    nbf: now,
    exp: now + 60,
    assignments: [grant('billing.viewer', 'all_customers')],
  };
};

describe('Billing authorization contract and scope', () => {
  it('does not combine global viewer scope with restricted invoice authority', () => {
    const auth = authorization([
      grant('billing.viewer', 'all_customers'),
      grant('billing.invoice_operator', 'organizations', [uuid(6)]),
    ]);
    expect(permissionScope(auth, 'billing.subscriptions.read')).toBeNull();
    expect(permissionScope(auth, 'billing.invoices.issue')).toEqual([uuid(6)]);
    expect(permissionScope(auth, 'billing.invoices.read')).toEqual([uuid(6)]);
    expect(() => permissionScope(auth, 'billing.catalog.manage')).toThrow(
      ForbiddenException,
    );
  });
  it('permits explicit catalog read without widening customer scope', () => {
    const auth = authorization([
      grant('billing.viewer', 'organizations', [uuid(6)]),
    ]);
    expect(permissionScope(auth, 'billing.catalog.read')).toBeNull();
    expect(permissionScope(auth, 'billing.subscriptions.read')).toEqual([
      uuid(6),
    ]);
    expect(() => permissionScope(auth, 'billing.invoices.read')).toThrow();
    expect(() =>
      permissionScope(
        authorization([grant('billing.catalog_manager', 'catalog_global')]),
        'billing.subscriptions.read',
      ),
    ).toThrow();
  });
  it('validates the exact signed v1 contract', () =>
    expect(validateBillingContext(claims(), expected).assignments).toHaveLength(
      1,
    ));
  it.each([
    { global_roles: ['platform_super_admin'] },
    { permissions: ['*'] },
    { identity_issuer: 'https://other.test' },
    { exp: 1 },
    { iat: 9999999999 },
    { nbf: 9999999999 },
    { assignments: [] },
    { assignments: [grant('billing.viewer', 'catalog_global')] },
    { assignments: [grant('billing.viewer', 'organizations', [])] },
    {
      assignments: [
        grant('billing.viewer', 'organizations', [uuid(6), uuid(6)]),
      ],
    },
    {
      assignments: [
        { ...grant('billing.viewer', 'all_customers'), expires_at: 1 },
      ],
    },
    {
      assignments: [
        { ...grant('billing.viewer', 'all_customers'), permissions: ['*'] },
      ],
    },
  ])('rejects malformed/incompatible claims %j', (overrides) =>
    expect(() =>
      validateBillingContext({ ...claims(), ...overrides }, expected),
    ).toThrow(ForbiddenException),
  );
  it('rejects a different catalog instead of falling back', () =>
    expect(() =>
      validateBillingContext({ ...claims(), catalog_version: 2 }, expected),
    ).toThrow(ConflictException));
  it('does not let TTL exceed the 300 second bound', () =>
    expect(() =>
      validateBillingContext(
        { ...claims(), exp: Math.floor(Date.now() / 1000) + 301 },
        expected,
      ),
    ).toThrow());
  it('rejects expired authorization even after earlier validation', () =>
    expect(() =>
      permissionScope(
        {
          ...authorization([grant('billing.viewer', 'all_customers')]),
          expiresAt: 1,
        },
        'billing.catalog.read',
      ),
    ).toThrow());

  it('allows catalog actions without roles while binding customer data to the signed membership organization', () => {
    const auth = validateBillingContext(
      { ...claims(), assignments: [] },
      expected,
      'authenticated',
    );
    expect(auth.assignments).toEqual([]);
    expect(permissionScope(auth, 'billing.catalog.manage')).toBeNull();
    expect(permissionScope(auth, 'billing.invoices.issue')).toEqual([
      expected.organizationId,
    ]);
    expect(permissionsForAuthorization(auth)).toEqual(
      expect.arrayContaining([
        'billing.catalog.manage',
        'billing.invoices.issue',
      ]),
    );
    expect(() => permissionScope(auth, 'billing.unknown.action')).toThrow();
  });
  it.each([
    { sub: 'another-user' },
    { identity_issuer: 'https://other.test' },
    { identity_reference_id: uuid(8) },
    { organization_id: uuid(8) },
    { membership_id: uuid(8) },
    { aud: 'legal-api' },
    { exp: 1 },
    { assignments: null },
  ])(
    'keeps signed context validation in authenticated mode: %j',
    (overrides) => {
      expect(() =>
        validateBillingContext(
          { ...claims(), assignments: [], ...overrides },
          expected,
          'authenticated',
        ),
      ).toThrow();
    },
  );
  it('does not turn missing organizations or expired authenticated contexts into global authority', () => {
    const auth = validateBillingContext(
      { ...claims(), assignments: [] },
      expected,
      'authenticated',
    );
    expect(() =>
      permissionScope(
        { ...auth, organizationId: undefined },
        'billing.catalog.manage',
      ),
    ).toThrow();
    expect(() =>
      permissionScope({ ...auth, expiresAt: 1 }, 'billing.invoices.issue'),
    ).toThrow();
  });
  it('keeps resource ownership checks and machine policies in authenticated mode', async () => {
    const f = guardFixture(uuid(8));
    f.request.billingAuthorization = validateBillingContext(
      { ...claims(), assignments: [] },
      expected,
      'authenticated',
    );
    await expect(f.guard.canActivate(f.context as never)).rejects.toThrow(
      'Resource outside authorized scope',
    );
    f.database.query.mockResolvedValue([
      { organization_id: expected.organizationId },
    ]);
    await expect(f.guard.canActivate(f.context as never)).resolves.toBe(true);
    Object.assign(f.request.principal, { isMachine: true });
    await expect(f.guard.canActivate(f.context as never)).rejects.toThrow(
      'Missing required permission',
    );
  });

  function guardFixture(owner: string | null, resource = 'invoices') {
    const request = {
      principal: { isMachine: false },
      params: { id: uuid(7) },
      billingAuthorization: authorization([
        grant('billing.invoice_operator', 'organizations', [uuid(6)]),
      ]),
    };
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === 'billing:resource'
          ? { kind: resource, parameter: 'id' }
          : ['billing.invoices.issue'],
      ),
    };
    const database = {
      query: jest.fn().mockResolvedValue([{ organization_id: owner }]),
    };
    const guard = new PermissionsGuard(
      reflector as never,
      database as never,
      {} as never,
    );
    const context = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    return { guard, context, request, database };
  }
  it('checks the stored owner instead of caller-controlled organization parameters', async () => {
    const f = guardFixture(uuid(8));
    Object.assign(f.request, {
      body: { organization_id: uuid(6) },
      query: { organization_id: uuid(6) },
    });
    await expect(f.guard.canActivate(f.context as never)).rejects.toThrow(
      ForbiddenException,
    );
    expect(f.database.query).toHaveBeenCalledWith(
      'SELECT organization_id FROM invoices WHERE id=$1',
      [uuid(7)],
    );
  });
  it('permits a resource within the action-specific scope', async () => {
    const f = guardFixture(uuid(6));
    await expect(f.guard.canActivate(f.context as never)).resolves.toBe(true);
  });
  it('rejects unknown webhook effects for a restricted operator', async () => {
    const f = guardFixture(uuid(6), 'webhook_events');
    f.database.query.mockResolvedValue([{ organization_id: null }]);
    await expect(f.guard.canActivate(f.context as never)).rejects.toThrow();
    expect(f.database.query).toHaveBeenCalled();
  });
  it('filters subscriptions before count and pagination', async () => {
    const builder = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const service = new BillingOperationsService(
      { createQueryBuilder: () => builder } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.listSubscriptions(
      { page: 1, limit: 10, organization_id: uuid(8) },
      [uuid(6)],
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'subscription.organizationId IN (:...authorizedOrganizations)',
      { authorizedOrganizations: [uuid(6)] },
    );
    expect(builder.andWhere.mock.invocationCallOrder[0]).toBeLessThan(
      builder.getManyAndCount.mock.invocationCallOrder[0],
    );
  });
});
