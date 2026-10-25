import type { FeatureAggregationStrategy, FeatureValueType } from '../catalog/catalog-api';
import type { PlanFormDraft } from '../catalog/plans/plan-form';

export type CopilotAgentId = 'product-draft' | 'plan-draft';
export type CopilotAgent = { id: CopilotAgentId; label: string; requiresProduct: boolean; enabled: boolean };
export type PlanDraft = {
  name: string; code: string; description: string;
  prices: { code: string; amount: string; currency: 'MXN' | 'USD'; billingInterval: 'month' | 'year'; billingIntervalCount: number }[];
  features: { code: string; name: string; valueType: FeatureValueType; value: string; unit: string; aggregationStrategy: FeatureAggregationStrategy; isMetered: boolean }[];
};

export type { PlanFormDraft } from '../catalog/plans/plan-form';

// Only editable plan fields belong in the agent context; provider mappings stay local.
export function planForAgent(plan: PlanFormDraft): PlanDraft {
  return {
    name: plan.name, code: plan.code, description: plan.description,
    prices: plan.prices.map(({ code, amount, currency, billingInterval, billingIntervalCount }) => ({ code, amount, currency, billingInterval, billingIntervalCount })),
    features: plan.features.map(({ code, name, valueType, value, unit, aggregationStrategy, isMetered }) => ({ code, name, valueType, value, unit, aggregationStrategy, isMetered })),
  };
}

export function copilotRoute(pathname: string, productId: string | null, tab: string | null) {
  if (pathname === '/products/new') return { agentId: 'product-draft' as const, productId: null };
  if (pathname === '/products/plans/new') return { agentId: 'plan-draft' as const, productId };
  const match = /^\/products\/([^/]+)$/.exec(pathname);
  if (match && match[1] !== 'plans') return { agentId: !tab || tab === 'plans' ? 'plan-draft' as const : null, productId: match[1] };
  return { agentId: null, productId: null };
}

export function conversationKey(agentId: CopilotAgentId | null, productId: string | null) {
  return agentId ? `${agentId}:${agentId === 'plan-draft' ? productId ?? 'unselected' : 'new'}` : 'unselected';
}
