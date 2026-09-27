import { PermanentError } from '@hemia/event-bus';
export const BILLING_ACCESS_EVENTS = [
  'access.organization.eligibility_changed.v1',
  'access.organization.suspended.v1',
  'access.organization.archived.v1',
  'access.membership.context_invalidated.v1',
  'access.membership.suspended.v1',
  'access.membership.revoked.v1',
  'access.membership.role_assigned.v1',
  'access.membership.role_revoked.v1',
  'access.organization_product.suspended.v1',
  'access.organization_product.disabled.v1',
  'access.organization_product.failed.v1',
] as const;
export type InvalidationTarget =
  | {
      kind: 'identity';
      issuer: string;
      subjectId: string;
      contextVersion?: number;
      organizationId: string;
    }
  | { kind: 'organization'; organizationId: string };

export function invalidationTarget(
  type: string,
  value: unknown,
): InvalidationTarget | null {
  if (!(BILLING_ACCESS_EVENTS as readonly string[]).includes(type))
    throw new PermanentError('Unsupported Access event');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PermanentError('Invalid Access event data');
  const data = value as Record<string, unknown>;
  const organizationId = string(data, 'organization_id');
  if (type.startsWith('access.organization_product.')) {
    if (string(data, 'product_code') !== 'billing') return null;
  }
  if (type === 'access.organization.eligibility_changed.v1') {
    const types = ['internal', 'customer', 'partner', 'vendor', 'sandbox'];
    if (
      !types.includes(string(data, 'type')) ||
      !types.includes(string(data, 'previous_type')) ||
      typeof data.eligible_internal !== 'boolean' ||
      data.eligible_internal !== (data.type === 'internal')
    )
      throw new PermanentError('Invalid eligibility');
    version(data.organization_version);
  }
  if (type.startsWith('access.membership.')) {
    if (type === 'access.membership.context_invalidated.v1') {
      for (const key of ['membership_id', 'identity_reference_id', 'reason'])
        string(data, key);
      version(data.context_version);
    } else if (data.context_version !== undefined)
      version(data.context_version);
    return {
      kind: 'identity',
      issuer: string(data, 'identity_issuer'),
      subjectId: string(data, 'subject_id'),
      organizationId,
      contextVersion: data.context_version as number | undefined,
    };
  }
  return { kind: 'organization', organizationId };
}
function string(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim())
    throw new PermanentError(`Missing ${key}`);
  return value;
}
function version(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new PermanentError('Invalid authorization version');
}
