import { Raw } from 'typeorm';
import { ServiceUnavailableException } from '@nestjs/common';
import { isUUID } from 'class-validator';

export function providerConnectionId(
  metadata?: Record<string, unknown> | null,
): string | null {
  const id = metadata?.providerConnectionId;
  if (id === undefined || id === null) return null;
  if (typeof id !== 'string' || !isUUID(id))
    throw new ServiceUnavailableException('Invalid pinned provider connection');
  return id;
}

export function assertProviderConnection(
  metadata: Record<string, unknown> | null | undefined,
  connectionId?: string | null,
): void {
  if (
    providerConnectionId(metadata) !==
    providerConnectionId({ providerConnectionId: connectionId })
  )
    throw new ServiceUnavailableException(
      'PayPal resource connection mismatch',
    );
}

export function providerConnectionWhere(connectionId?: string | null) {
  const id = providerConnectionId({ providerConnectionId: connectionId });
  return Raw(
    (alias) => {
      const column = alias
        .split('.')
        .map((part) => `"${part.replace(/"/g, '""')}"`)
        .join('.');
      return `COALESCE(${column}->>'providerConnectionId','global') = :providerConnectionId`;
    },
    { providerConnectionId: id ?? 'global' },
  );
}
