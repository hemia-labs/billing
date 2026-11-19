import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  BillingPaypalConnectionEntity,
  BillingProductEntity,
  BillingProvider,
  ProviderPriceStatus,
} from '../billing-shared';

export type ProviderPriceScope = {
  connectionScope: 'unassigned' | 'global' | 'connection';
  providerConnectionId: string | null;
};

export function matchesProviderPriceScope(
  mapping: ProviderPriceScope,
  connectionId: string | null,
): boolean {
  if (connectionId === undefined)
    throw new BadRequestException('Provider connection context is required');
  return connectionId === null
    ? mapping.connectionScope === 'global' &&
        mapping.providerConnectionId === null
    : mapping.connectionScope === 'connection' &&
        mapping.providerConnectionId === connectionId;
}

export function resolveProviderPrice<
  T extends ProviderPriceScope & {
    provider: BillingProvider;
    status: ProviderPriceStatus;
  },
>(mappings: T[], provider: BillingProvider, connectionId: string | null): T {
  const matches = mappings.filter(
    (mapping) =>
      mapping.provider === provider &&
      mapping.status === ProviderPriceStatus.Active &&
      matchesProviderPriceScope(mapping, connectionId),
  );
  if (matches.length !== 1)
    throw new ConflictException({
      code: 'BILLING_PROVIDER_PRICE_NOT_CONFIGURED',
      message:
        'No unique active provider price is configured for the selected provider connection',
    });
  return matches[0];
}

export async function validateProviderPriceScope(
  manager: EntityManager,
  productId: string,
  mapping: ProviderPriceScope & { provider: BillingProvider },
): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Provider price writes require a transaction');
  const product = await manager
    .getRepository(BillingProductEntity)
    .findOne({ where: { id: productId }, lock: { mode: 'pessimistic_write' } });
  if (!product) throw new NotFoundException('Billing product not found');
  if (
    mapping.connectionScope === 'global' &&
    mapping.providerConnectionId === null
  )
    return;
  if (
    mapping.connectionScope !== 'connection' ||
    mapping.provider !== BillingProvider.Paypal ||
    typeof mapping.providerConnectionId !== 'string'
  )
    throw new BadRequestException(
      'Explicit provider connection scope is required',
    );
  const connection = await manager
    .getRepository(BillingPaypalConnectionEntity)
    .findOneBy({ id: mapping.providerConnectionId, productId, isDraft: false });
  if (!connection)
    throw new BadRequestException(
      'Provider connection must belong to this product and cannot be a draft',
    );
}

export function rethrowProviderPriceConflict(error: unknown): never {
  if ((error as { code?: string })?.code === '23505')
    throw new ConflictException({
      code: 'BILLING_PROVIDER_PRICE_SCOPE_CONFLICT',
      message: 'An active provider price already exists for this connection',
    });
  throw error;
}
