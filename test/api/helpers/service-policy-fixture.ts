import { ConfigService } from '@nestjs/config';
import { BillingServiceClientRegistryService } from '../../../apps/api/src/common/services/billing-service-client-registry.service';
import {
  parseBillingServicePolicy,
  BillingServiceClientPolicy,
} from '../../../apps/api/src/common/types/billing-service-policy';

export function policyFixture(
  value: string,
): Record<string, BillingServiceClientPolicy> {
  try {
    const record: unknown = JSON.parse(value);
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error();
    return Object.fromEntries(
      Object.entries(record).map(([id, policy]) => [
        id,
        parseBillingServicePolicy(policy),
      ]),
    );
  } catch {
    throw new Error('Invalid Billing service policies');
  }
}
export function policyRegistry(
  config: ConfigService,
): BillingServiceClientRegistryService {
  return {
    findPolicy: (clientId: string) =>
      Promise.resolve(
        config.get<Record<string, BillingServiceClientPolicy>>(
          'auth.storedPolicies',
        )?.[clientId],
      ),
  } as BillingServiceClientRegistryService;
}
