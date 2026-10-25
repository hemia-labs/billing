import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { AgentEvent, ReasoningEffort } from '@fevex/core';
import { BillingCatalogService } from '../catalog/billing-catalog.service';
import type { AuthenticatedPrincipal } from '../../common/types/authenticated-request.type';
import { CopilotSessionsService } from './copilot-sessions.service';
import {
  copilotAgents,
  copilotInputSchema,
  validateCopilotOutput,
} from './copilot-agents';

export type CopilotModel = {
  id: string;
  provider: 'deepseek' | 'openai';
  model: string;
  label: string;
  efforts: ReasoningEffort[];
};

const defaultModels =
  'deepseek:deepseek-flash,openai:gpt-6-luna,openai:gpt-6-sol';
const deepseekEfforts: ReasoningEffort[] = [
  'provider-default',
  'none',
  'low',
  'high',
  'max',
];
const openaiEfforts: ReasoningEffort[] = [
  'provider-default',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
const openaiEffortsWithNone: ReasoningEffort[] = [
  'provider-default',
  'none',
  ...openaiEfforts.slice(1),
];

@Injectable()
export class BillingCopilotService {
  constructor(
    private readonly catalog: BillingCatalogService,
    private readonly sessions: CopilotSessionsService,
  ) {}

  listAgents() {
    return Object.entries(copilotAgents).map(([id, agent]) => ({
      id,
      enabled: agent.enabled,
      label: agent.label,
      requiresProduct: agent.requiresProduct,
    }));
  }

  private sessionScope(value: unknown, principal?: AuthenticatedPrincipal) {
    if (!principal?.sub) throw new UnauthorizedException();
    const input = z
      .object({
        sessionId: z.string().uuid(),
        agentId: z.enum(['product-draft', 'plan-draft']),
        productId: z.string().uuid().optional(),
      })
      .strict()
      .safeParse(value);
    if (!input.success) throw new BadRequestException('Sesión inválida.');
    const { sessionId, agentId, productId } = input.data;
    return {
      sessionId,
      agentId,
      scope: [
        principal.sub,
        principal.organizationId ?? '',
        agentId,
        productId ?? 'new',
      ],
    };
  }

  async deleteSession(value: unknown, principal?: AuthenticatedPrincipal) {
    const { scope, sessionId } = this.sessionScope(value, principal);
    await this.sessions.delete(scope, sessionId);
  }

  async readSession(value: unknown, principal?: AuthenticatedPrincipal) {
    const { scope, sessionId, agentId } = this.sessionScope(value, principal);
    const session = await this.sessions.read(scope, sessionId);
    if (!session) throw new NotFoundException('La conversación expiró.');
    const messages = session.history.map((item, index) => {
      const id = `${sessionId}:${index}`;
      if (item.role === 'user') {
        const input = JSON.parse(item.content) as { instruction: string };
        return { id, role: 'user' as const, content: input.instruction };
      }
      const output = validateCopilotOutput(agentId, JSON.parse(item.content));
      return {
        id,
        role: 'assistant' as const,
        content: output.message,
        status: 'completed' as const,
        ...('product' in output && output.product
          ? { product: output.product }
          : {}),
        ...('plan' in output && output.plan ? { plan: output.plan } : {}),
      };
    });
    return { sessionId, messages };
  }

  async prepareRun(value: unknown, principal?: AuthenticatedPrincipal) {
    const parsed = copilotInputSchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException(
        'Solicitud inválida. Revisa la tarea y su contexto.',
      );
    const input = parsed.data;
    const model = this.listModels().find((item) => item.id === input.modelId);
    if (!model) throw new BadRequestException('Modelo no disponible.');
    if (!model.efforts.includes(input.effort as ReasoningEffort))
      throw new BadRequestException('Esfuerzo no disponible para este modelo.');
    // The server resolves the selected product; only its descriptive fields reach the agent.
    const product = input.productId
      ? await this.catalog.getProduct(input.productId)
      : undefined;
    const selectedProduct = product
      ? {
          name: product.name,
          code: product.code,
          description: product.description,
          status: product.status,
        }
      : undefined;
    if (!copilotAgents[input.agentId].enabled)
      throw new BadRequestException('Este agente todavía no está habilitado.');
    if (!principal?.sub) throw new UnauthorizedException();
    return {
      input,
      model,
      selectedProduct,
      scope: [
        principal.sub,
        principal.organizationId ?? '',
        input.agentId,
        input.productId ?? 'new',
      ],
    };
  }

  async *streamRun(
    prepared: Awaited<ReturnType<BillingCopilotService['prepareRun']>>,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    const { input, model, scope, selectedProduct } = prepared;
    const [
      { createFevex, defineAgent, InMemoryRunStore },
      { createDeepSeek },
      { createOpenAI },
    ] = await Promise.all([
      import('@fevex/core'),
      import('@fevex/deepseek'),
      import('@fevex/openai'),
    ]);
    signal.throwIfAborted();
    const gateway =
      model.provider === 'deepseek'
        ? createDeepSeek({
            apiKey: process.env.DEEPSEEK_API_KEY!,
            schemaPolicy: 'best-effort',
          })(model.model)
        : createOpenAI({
            apiKey: process.env.OPENAI_API_KEY!,
            project: process.env.OPENAI_PROJECT_ID || undefined,
          })(model.model);
    const definition = copilotAgents[input.agentId];
    const agent = defineAgent({
      name: input.agentId,
      instructions: definition.instructions,
      outputSchema: definition.outputSchema,
      limits: { maxSteps: 2, maxOutputTokens: 6000 },
      ...(model.provider === 'openai'
        ? { modelOptions: { store: false } }
        : {}),
    });
    const sessionId = input.sessionId ?? randomUUID();
    const saved = await this.sessions.acquire(scope, sessionId);
    try {
      if (input.continueSession && saved.expired)
        throw new ConflictException('SESSION_EXPIRED');
      signal.throwIfAborted();
      const runStore = new InMemoryRunStore();
      // Redis owns conversation persistence; Fevex owns the native history format.
      await runStore.saveSession({ ...saved.session, revision: undefined });
      const fevex = createFevex({
        runStore,
        models: { default: gateway },
        agents: [agent],
      });
      for await (const event of fevex.streamAgent(agent.name, {
        sessionId,
        input: JSON.stringify({
          instruction: input.instruction,
          ...(input.agentId === 'product-draft'
            ? { currentProduct: input.currentProduct ?? null }
            : { currentPlan: input.currentPlan ?? null, selectedProduct }),
        }),
        reasoning: input.effort as ReasoningEffort,
        signal,
      })) {
        if (event.type === 'run.completed') {
          const output = validateCopilotOutput(
            input.agentId,
            event.payload.output,
          );
          const session = await runStore.getSession(sessionId);
          if (!session) throw new Error('Session missing after completion');
          signal.throwIfAborted();
          await saved.commit(session);
          yield {
            ...event,
            payload: {
              ...event.payload,
              output,
            },
          };
        } else yield event;
      }
    } finally {
      await saved.release();
    }
  }

  listModels(): CopilotModel[] {
    const models: CopilotModel[] = [];
    const configured = process.env.FEVEX_MODELS || defaultModels;
    for (const item of configured.split(',')) {
      const entry = item.trim();
      const separator = entry.indexOf(':');
      const provider = entry.slice(0, separator) as CopilotModel['provider'];
      const model = entry.slice(separator + 1).trim();
      if (!model || !['deepseek', 'openai'].includes(provider)) continue;
      if (
        !process.env[
          provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY'
        ]?.trim()
      )
        continue;
      const id = `${provider}:${model}`;
      if (models.some((item) => item.id === id)) continue;
      models.push({
        id,
        provider,
        model,
        label: model,
        efforts:
          provider === 'deepseek'
            ? deepseekEfforts
            : /^gpt-6-(sol|luna)(?:$|-)/.test(model)
              ? openaiEffortsWithNone
              : openaiEfforts,
      });
    }
    return models;
  }
}
