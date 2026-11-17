import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  BillingProvider,
  ProviderPriceStatus,
} from '../../../../apps/api/src/modules/billing-shared';
import { resolveProviderPrice } from '../../../../apps/api/src/modules/catalog/provider-price-scope';
import { CreateProviderPriceDto } from '../../../../apps/api/src/modules/catalog/dtos';
const a = randomUUID(),
  b = randomUUID();
const mapping = (
  id: string,
  scope: 'global' | 'connection' | 'unassigned',
  connectionId: string | null,
) => ({
  id,
  provider: BillingProvider.Paypal,
  status: ProviderPriceStatus.Active,
  connectionScope: scope,
  providerConnectionId: connectionId,
});
describe('provider price connection scope', () => {
  const rows = [
    mapping('legacy', 'unassigned', null),
    mapping('global', 'global', null),
    mapping('a', 'connection', a),
    mapping('b', 'connection', b),
  ];
  it.each([
    [null, 'global'],
    [a, 'a'],
    [b, 'b'],
  ])('selects only the exact connection %s', (connection, id) => {
    expect(
      resolveProviderPrice(rows, BillingProvider.Paypal, connection).id,
    ).toBe(id);
  });
  it('never falls back from missing A to global, B, or unassigned', () => {
    expect(() =>
      resolveProviderPrice(rows, BillingProvider.Paypal, randomUUID()),
    ).toThrow('No unique active provider price');
  });
  it('rejects duplicate active mappings rather than choosing the first', () => {
    expect(() =>
      resolveProviderPrice(
        [...rows, mapping('a-duplicate', 'connection', a)],
        BillingProvider.Paypal,
        a,
      ),
    ).toThrow('No unique active provider price');
  });
  it('ignores archived mappings for new selections', () => {
    expect(() =>
      resolveProviderPrice(
        rows.map((row) => ({
          ...row,
          status: row.id === 'a' ? ProviderPriceStatus.Archived : row.status,
        })),
        BillingProvider.Paypal,
        a,
      ),
    ).toThrow('No unique active provider price');
  });
  it.each([
    { provider: 'paypal', providerPriceId: 'P-TEST' },
    {
      provider: 'paypal',
      connectionScope: 'unassigned',
      providerConnectionId: null,
      providerPriceId: 'P-TEST',
    },
    {
      provider: 'paypal',
      connectionScope: 'connection',
      providerConnectionId: null,
      providerPriceId: 'P-TEST',
    },
    {
      provider: 'paypal',
      connectionScope: 'connection',
      providerConnectionId: 'invalid',
      providerPriceId: 'P-TEST',
    },
    {
      provider: 'paypal',
      connectionScope: 'global',
      providerConnectionId: null,
      providerPriceId: '',
    },
  ])('rejects incomplete or ambiguous new mappings %#', (payload) => {
    expect(
      validateSync(plainToInstance(CreateProviderPriceDto, payload)).length,
    ).toBeGreaterThan(0);
  });
  it('accepts an explicit global mapping', () => {
    expect(
      validateSync(
        plainToInstance(CreateProviderPriceDto, {
          provider: 'paypal',
          connectionScope: 'global',
          providerConnectionId: null,
          providerPriceId: 'P-TEST',
        }),
      ),
    ).toEqual([]);
  });
});
