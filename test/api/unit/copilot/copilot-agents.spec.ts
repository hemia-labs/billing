import {
  copilotInputSchema,
  validateCopilotOutput,
} from '../../../../apps/api/src/modules/copilot/copilot-agents';
import { BillingCopilotService } from '../../../../apps/api/src/modules/copilot/billing-copilot.service';
import { BillingCatalogService } from '../../../../apps/api/src/modules/catalog/billing-catalog.service';
import { CopilotSessionsService } from '../../../../apps/api/src/modules/copilot/copilot-sessions.service';

const productId = '09135fe8-b7de-4d74-a910-1ce41df55618';
const plan = {
  name: 'Pro',
  code: 'pro',
  description: 'Plan para equipos',
  prices: [
    {
      code: 'pro_month_mxn',
      amount: '299.00',
      currency: 'MXN',
      billingInterval: 'month',
      billingIntervalCount: 1,
    },
  ],
  features: [
    {
      code: 'users',
      name: 'Usuarios',
      valueType: 'integer',
      value: '5',
      unit: 'usuarios',
      aggregationStrategy: 'replace',
      isMetered: false,
    },
  ],
};

describe('Copilot agent contracts', () => {
  it('enables plans with local product validation and an isolated conversation scope', async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    const previousModels = process.env.FEVEX_MODELS;
    process.env.OPENAI_API_KEY = 'test-only';
    process.env.FEVEX_MODELS = 'openai:test';
    const getProduct = jest.fn().mockResolvedValue({
      id: productId,
      name: 'Agenda',
      code: 'agenda',
      description: 'Reservas',
      status: 'active',
      providerMetadata: { secret: 'excluded' },
    });
    try {
      const service = new BillingCopilotService(
        { getProduct } as unknown as BillingCatalogService,
        {} as CopilotSessionsService,
      );
      expect(
        service.listAgents().find((agent) => agent.id === 'plan-draft')
          ?.enabled,
      ).toBe(true);
      const prepared = await service.prepareRun(
        {
          agentId: 'plan-draft',
          productId,
          instruction: 'Plan mensual',
          modelId: 'openai:test',
          effort: 'low',
          currentPlan: plan,
        },
        { sub: 'user', organizationId: 'org', scopes: [], isMachine: false },
      );
      expect(getProduct).toHaveBeenCalledWith(productId);
      expect(prepared.scope).toEqual(['user', 'org', 'plan-draft', productId]);
      expect(prepared.selectedProduct).toEqual({
        name: 'Agenda',
        code: 'agenda',
        description: 'Reservas',
        status: 'active',
      });
      expect(JSON.stringify(prepared.selectedProduct)).not.toContain(productId);
      expect(JSON.stringify(prepared.selectedProduct)).not.toContain(
        'excluded',
      );
    } finally {
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousModels === undefined) delete process.env.FEVEX_MODELS;
      else process.env.FEVEX_MODELS = previousModels;
    }
  });
  it('rejects cross-agent proposals and extra fields instead of silently stripping them', () => {
    const product = {
      name: 'Agenda',
      code: 'agenda',
      description: 'Reservas',
      status: 'active',
    };
    for (const output of [
      { message: 'Propuesta', product, plan },
      { message: 'Propuesta', product: { ...product, prices: plan.prices } },
      { message: 'Propuesta', product, action: 'save' },
    ])
      expect(() => validateCopilotOutput('product-draft', output)).toThrow();
    for (const output of [
      { message: 'Propuesta', plan, product },
      { message: 'Propuesta', plan: { ...plan, productId } },
      {
        message: 'Propuesta',
        plan: { ...plan, prices: [{ ...plan.prices[0], providerPrices: [] }] },
      },
      {
        message: 'Propuesta',
        plan: {
          ...plan,
          features: [{ ...plan.features[0], execute: 'command' }],
        },
      },
    ])
      expect(() => validateCopilotOutput('plan-draft', output)).toThrow();
  });

  it('requires a product for plans and rejects mismatched or excessive context', () => {
    const input = {
      agentId: 'plan-draft',
      instruction: 'Plan Pro',
      modelId: 'openai:test',
      effort: 'low',
    };
    expect(copilotInputSchema.safeParse(input).success).toBe(false);
    expect(copilotInputSchema.safeParse({ ...input, productId }).success).toBe(
      true,
    );
    expect(
      copilotInputSchema.safeParse({
        ...input,
        productId,
        currentProduct: { name: 'spoofed' },
      }).success,
    ).toBe(false);
    expect(
      copilotInputSchema.safeParse({
        ...input,
        productId,
        history: Array.from({ length: 13 }, () => ({
          role: 'user',
          content: 'hello',
        })),
      }).success,
    ).toBe(false);
  });

  it('validates proposals and conversational responses independently', () => {
    expect(
      validateCopilotOutput('plan-draft', { message: 'Propuesta', plan }),
    ).toEqual({ message: 'Propuesta', plan });
    expect(
      validateCopilotOutput('plan-draft', {
        message: '¿Cuál es el precio?',
        plan: null,
      }),
    ).toEqual({ message: '¿Cuál es el precio?', plan: null });
    expect(() =>
      validateCopilotOutput('product-draft', {
        message: 'Listo',
        product: { name: '', code: '', description: '', status: 'active' },
      }),
    ).toThrow();
  });

  it('rejects invalid money, duplicate price codes and inconsistent feature values', () => {
    for (const invalid of [
      { ...plan, prices: [{ ...plan.prices[0], amount: '-10' }] },
      { ...plan, prices: [{ ...plan.prices[0], amount: '0.001' }] },
      { ...plan, prices: [plan.prices[0], plan.prices[0]] },
      { ...plan, features: [{ ...plan.features[0], value: '4.5' }] },
      {
        ...plan,
        features: [
          {
            ...plan.features[0],
            valueType: 'boolean',
            value: 'true',
            aggregationStrategy: 'sum',
          },
        ],
      },
    ])
      expect(() =>
        validateCopilotOutput('plan-draft', {
          message: 'Propuesta',
          plan: invalid,
        }),
      ).toThrow();
  });

  it('checks product existence through the catalog before opening a stream', async () => {
    const key = process.env.OPENAI_API_KEY;
    const models = process.env.FEVEX_MODELS;
    process.env.OPENAI_API_KEY = 'test-only';
    process.env.FEVEX_MODELS = 'openai:test';
    const getProduct = jest
      .fn()
      .mockRejectedValue(new Error('Product not found'));
    try {
      const service = new BillingCopilotService(
        {
          getProduct,
        } as unknown as BillingCatalogService,
        {} as CopilotSessionsService,
      );
      await expect(
        service.prepareRun({
          agentId: 'plan-draft',
          productId,
          instruction: 'Plan',
          modelId: 'openai:test',
          effort: 'low',
        }),
      ).rejects.toThrow('Product not found');
      expect(getProduct).toHaveBeenCalledWith(productId);
    } finally {
      if (key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = key;
      if (models === undefined) delete process.env.FEVEX_MODELS;
      else process.env.FEVEX_MODELS = models;
    }
  });
});
