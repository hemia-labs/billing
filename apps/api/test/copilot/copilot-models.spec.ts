import { BillingCopilotService } from '../../src/modules/copilot/billing-copilot.service';
import { CopilotSessionsService } from '../../src/modules/copilot/copilot-sessions.service';
const sessions = {} as CopilotSessionsService;

import { productDraftResponseSchema } from '../../src/modules/copilot/copilot-agents';
import { BillingCatalogService } from '../../src/modules/catalog/billing-catalog.service';
const catalog = { getProduct: jest.fn() } as unknown as BillingCatalogService;

describe('BillingCopilotService', () => {
  const originalEnv = {
    FEVEX_MODELS: process.env.FEVEX_MODELS,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('lists multiple models from both providers in one ordered selector', () => {
    process.env.FEVEX_MODELS =
      'deepseek:deepseek-chat, deepseek:deepseek-reasoner, openai:gpt-a,openai:gpt-b';
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const models = new BillingCopilotService(catalog, sessions).listModels();

    expect(models.map(({ id }) => id)).toEqual([
      'deepseek:deepseek-chat',
      'deepseek:deepseek-reasoner',
      'openai:gpt-a',
      'openai:gpt-b',
    ]);
    expect(models.map(({ label }) => label)).toEqual([
      'deepseek-chat',
      'deepseek-reasoner',
      'gpt-a',
      'gpt-b',
    ]);
    expect(models[0].efforts).toEqual([
      'provider-default',
      'none',
      'low',
      'high',
      'max',
    ]);
    expect(models[2].efforts).toEqual([
      'provider-default',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('hides providers without a key and removes duplicate models', () => {
    process.env.FEVEX_MODELS =
      'deepseek:deepseek-chat,openai:gpt-a,openai:gpt-a';
    process.env.DEEPSEEK_API_KEY = '';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    expect(
      new BillingCopilotService(catalog, sessions)
        .listModels()
        .map(({ id }) => id),
    ).toEqual(['openai:gpt-a']);
  });

  it('offers none only for the GPT-6 models that support it', () => {
    process.env.FEVEX_MODELS =
      'openai:gpt-6-astra,openai:gpt-6-sol,openai:gpt-6-luna';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const models = new BillingCopilotService(catalog, sessions).listModels();

    expect(models[0].efforts).not.toContain('none');
    expect(models[1].efforts).toContain('none');
    expect(models[2].efforts).toContain('none');
    for (const model of models) {
      expect(model.efforts).toEqual(
        expect.arrayContaining(['low', 'medium', 'high']),
      );
    }
  });

  it('accepts a conversational answer without an incomplete product', () => {
    expect(
      productDraftResponseSchema.safeParse({
        message: 'Hola, ¿qué producto quieres crear?',
        product: null,
      }).success,
    ).toBe(true);
    expect(
      productDraftResponseSchema.safeParse({
        message: 'Preparé una propuesta.',
        product: {
          name: 'Reservas',
          code: 'reservas',
          description: 'Gestiona turnos.',
          status: 'active',
        },
      }).success,
    ).toBe(true);
  });
});
