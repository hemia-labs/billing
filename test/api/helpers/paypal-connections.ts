import type { PaypalConnectionsService } from '../../../apps/api/src/modules/paypal-connections/paypal-connections.service';
export const legacyPaypalConnections = {
  resolveForProduct: () => Promise.resolve(null),
  credentialsForConnection: () =>
    Promise.reject(new Error('Unknown test PayPal connection')),
  listForRecovery: () =>
    Promise.resolve([{ id: null, environment: 'sandbox' as const }]),
} as unknown as PaypalConnectionsService;
