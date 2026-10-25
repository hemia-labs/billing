import { ConflictException, ForbiddenException } from '@nestjs/common';
import catalog from '../billing-authorization-v1.json';

export type BillingAssignment = {
  assignment_id: string;
  assignment_version: number;
  role_code: string;
  scope: { type: string; organization_ids?: string[] };
  valid_from: number;
  expires_at: number | null;
};
export type BillingAuthorization = {
  assignments: BillingAssignment[];
  expiresAt: number;
};
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
function deny(): never {
  throw new ForbiddenException('Invalid Billing authorization context');
}

/** Called only after SDK signature/issuer/audience/type verification. */
export function validateBillingContext(
  claims: Record<string, unknown>,
  expected: {
    subject: string;
    issuer: string;
    identityReferenceId: string;
    organizationId: string;
    membershipId: string;
  },
): BillingAuthorization {
  if (claims.contract_version !== 1 || claims.catalog_version !== 1)
    throw new ConflictException('BILLING_AUTHORIZATION_CONTRACT_MISMATCH');
  const now = Math.floor(Date.now() / 1000);
  if (
    !exact(claims, [
      'iss',
      'aud',
      'sub',
      'identity_issuer',
      'identity_reference_id',
      'organization_id',
      'membership_id',
      'product_code',
      'contract_version',
      'catalog_version',
      'context_version',
      'jti',
      'iat',
      'nbf',
      'exp',
      'assignments',
    ]) ||
    claims.sub !== expected.subject ||
    claims.identity_issuer !== expected.issuer ||
    claims.identity_reference_id !== expected.identityReferenceId ||
    claims.organization_id !== expected.organizationId ||
    claims.membership_id !== expected.membershipId ||
    !uuid(claims.identity_reference_id) ||
    !uuid(claims.organization_id) ||
    !uuid(claims.membership_id) ||
    !uuid(claims.jti) ||
    claims.product_code !== 'billing' ||
    claims.aud !== 'billing-api' ||
    !integer(claims.context_version) ||
    !integer(claims.iat) ||
    !integer(claims.nbf) ||
    !integer(claims.exp) ||
    claims.iat > now ||
    claims.nbf > now ||
    claims.exp <= now ||
    claims.exp <= claims.iat ||
    claims.exp > claims.iat + 300 ||
    !Array.isArray(claims.assignments) ||
    !claims.assignments.length ||
    claims.assignments.length > 64
  )
    deny();
  const assignments: BillingAssignment[] = [];
  const seen = new Set<string>();
  let targetCount = 0;
  for (const value of claims.assignments as unknown[]) {
    if (
      !record(value) ||
      !exact(value, [
        'assignment_id',
        'assignment_version',
        'role_code',
        'scope',
        'valid_from',
        'expires_at',
      ]) ||
      !uuid(value.assignment_id) ||
      seen.has(value.assignment_id) ||
      !integer(value.assignment_version) ||
      !integer(value.valid_from) ||
      value.valid_from > now ||
      !(
        value.expires_at === null ||
        (integer(value.expires_at) &&
          value.expires_at > now &&
          value.expires_at > value.valid_from &&
          claims.exp <= value.expires_at)
      ) ||
      !record(value.scope)
    )
      deny();
    const role = catalog.roles.find((r) => r.code === value.role_code);
    if (!role || !role.allowed_scopes.includes(value.scope.type as string))
      deny();
    if (value.scope.type === 'organizations') {
      const ids = value.scope.organization_ids;
      if (
        !exact(value.scope, ['type', 'organization_ids']) ||
        !Array.isArray(ids) ||
        !ids.length ||
        !ids.every(uuid) ||
        new Set(ids.map((id) => id.toLowerCase())).size !== ids.length
      )
        deny();
      targetCount += ids.length;
    } else if (!exact(value.scope, ['type'])) deny();
    seen.add(value.assignment_id);
    assignments.push(value as unknown as BillingAssignment);
  }
  if (targetCount > 1000) deny();
  return { assignments, expiresAt: claims.exp };
}

export function permissionScope(
  auth: BillingAuthorization,
  permission: string,
): string[] | null {
  if (auth.expiresAt <= Math.floor(Date.now() / 1000)) deny();
  const definition = catalog.permissions.find((p) => p.code === permission);
  if (!definition) deny();
  const matching = auth.assignments.filter((a) => {
    const role = catalog.roles.find((r) => r.code === a.role_code);
    return (
      role?.permissions.includes(permission) &&
      a.valid_from <= Date.now() / 1000 &&
      (a.expires_at === null || a.expires_at > Date.now() / 1000)
    );
  });
  if (definition.resource_domain === 'catalog') {
    if (
      matching.some(
        (a) =>
          permission === 'billing.catalog.read' ||
          a.scope.type === 'catalog_global',
      )
    )
      return null;
    deny();
  }
  if (matching.some((a) => a.scope.type === 'all_customers')) return null;
  const ids = [
    ...new Set(
      matching
        .filter((a) => a.scope.type === 'organizations')
        .flatMap((a) => a.scope.organization_ids ?? []),
    ),
  ];
  if (!ids.length) deny();
  return ids;
}
export function permissionsForAuthorization(
  auth: BillingAuthorization,
): string[] {
  return catalog.permissions
    .filter((p) => {
      try {
        permissionScope(auth, p.code);
        return true;
      } catch {
        return false;
      }
    })
    .map((p) => p.code);
}
