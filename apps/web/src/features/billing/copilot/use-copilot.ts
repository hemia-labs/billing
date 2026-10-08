"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/components/auth-gate';
import type { CopilotMessage } from './copilot-chat';
import type { CatalogProductPayload } from '../catalog/catalog-api';
import { ApiError, apiErrorMessage, redirectToLogin } from '@/lib/api';
import { getCopilotSession, deleteCopilotSession, extractStreamingMessage, listCopilotAgents, listCopilotModels, streamCopilot, type CopilotModel } from './copilot-api';
import { conversationKey, copilotRoute, planForAgent, type CopilotAgent, type CopilotAgentId, type PlanDraft, type PlanFormDraft } from './copilot-types';

type Conversation = {
  restored?: boolean;
  restoreError?: string;
  sessionId?: string;
  messages: CopilotMessage[];
  productDraft?: { id: string; product: CatalogProductPayload };
  currentProduct?: CatalogProductPayload;
  planDraft?: { id: string; plan: PlanDraft };
  currentPlan?: PlanFormDraft;
};
const empty: Conversation = { messages: [] };

export function useCopilot(open: boolean) {
  const auth = useSession();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const { agentId, productId } = copilotRoute(pathname, params.get('product_id'), params.get('tab'));
  const inForm = pathname === '/products/new' || pathname === '/products/plans/new';
  const key = conversationKey(agentId, productId);
  const storageKey = `billing:mia:${JSON.stringify([auth.user.ssoUserId, auth.organizationId ?? '', key])}`;
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const conversation = conversations[key] ?? empty;
  const [models, setModels] = useState<CopilotModel[]>([]);
  const [agents, setAgents] = useState<CopilotAgent[]>([]);
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [selection, setSelection] = useState({ modelId: '', effort: 'provider-default' });
  const abortRef = useRef<AbortController | null>(null);
  const restoreRef = useRef<AbortController | null>(null);
  const cleanupRef = useRef(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupNotice, setCleanupNotice] = useState('');
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  useEffect(() => {
    if (!open || !agentId || conversation.restored) return;
    const controller = new AbortController();
    restoreRef.current = controller;
    void Promise.resolve().then(async () => {
      setConversations(current => ({ ...current, [key]: { ...(current[key] ?? empty), restoreError: undefined } }));
      let sessionId: string | null = null;
      try { sessionId = sessionStorage.getItem(storageKey); } catch { /* Storage can be disabled by browser policy. */ }
      const restored = sessionId ? await getCopilotSession(sessionId, agentId, productId, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])) : { messages: [] };
      if (!controller.signal.aborted) setConversations(current => ({ ...current, [key]: { ...(current[key] ?? empty), ...restored, restored: true } }));
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) redirectToLogin();
      if (error instanceof ApiError && error.status === 404) {
        try { sessionStorage.removeItem(storageKey); } catch { /* TTL is the fallback. */ }
        setConversations(current => ({ ...current, [key]: { ...(current[key] ?? empty), restored: true, sessionId: undefined, messages: [] } }));
        setCleanupNotice('La conversación anterior expiró. Puedes iniciar una nueva.');
      } else setConversations(current => ({ ...current, [key]: { ...(current[key] ?? empty), restoreError: 'No pudimos recuperar la conversación.' } }));
    });
    return () => controller.abort();
  }, [open, key, agentId, productId, storageKey, conversation.restored, restoreAttempt]);

  useEffect(() => () => { abortRef.current?.abort(); abortRef.current = null; }, [key]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setModelStatus('loading');
      return Promise.all([listCopilotModels(), listCopilotAgents()]);
    }).then(([availableModels, availableAgents]) => {
      if (!active) return;
      setModels(availableModels); setAgents(availableAgents); setModelStatus('ready');
      setSelection(current => availableModels.some(model => model.id === current.modelId && model.efforts.includes(current.effort)) ? current : { modelId: availableModels[0]?.id ?? '', effort: 'provider-default' });
    }).catch(error => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) redirectToLogin();
      setModels([]); setAgents([]); setModelStatus('error');
    });
    return () => { active = false; };
  }, [open]);

  const update = useCallback((change: Partial<Conversation>) => {
    setConversations(current => ({ ...current, [key]: { ...(current[key] ?? empty), ...change } }));
  }, [key]);
  const setCurrentProduct = useCallback((product: CatalogProductPayload) => update({ currentProduct: product }), [update]);
  const setCurrentPlan = useCallback((plan: PlanFormDraft) => update({ currentPlan: plan }), [update]);
  const discard = useCallback(async (clearForm: boolean) => {
    if (cleanupRef.current) return;
    cleanupRef.current = true;
    setCleaning(true);
    setCleanupNotice('');
    restoreRef.current?.abort();
    abortRef.current?.abort();
    try {
      let sessionId = conversation.sessionId;
      if (!sessionId) { try { sessionId = sessionStorage.getItem(storageKey) ?? undefined; } catch { /* Optional storage. */ } }
      if (sessionId && agentId) await deleteCopilotSession(sessionId, agentId, productId);
    } catch {
      setCleanupNotice(clearForm ? 'Los datos se guardaron, pero no pudimos limpiar el historial de MIA. Se eliminará al vencer su plazo de inactividad.' : 'No pudimos borrar la conversación. Vuelve a intentarlo.');
      if (!clearForm) return;
    } finally {
      cleanupRef.current = false;
      setCleaning(false);
    }
    try { sessionStorage.removeItem(storageKey); } catch { /* TTL is the fallback. */ }
    setConversations(current => {
      const next = { ...current };
      if (clearForm) delete next[key];
      else next[key] = { ...(current[key] ?? empty), messages: [], sessionId: undefined, restored: true, restoreError: undefined };
      return next;
    });
  }, [key, conversation.sessionId, agentId, productId, storageKey]);
  const clear = useCallback(() => discard(true), [discard]);

  function changeAgent(id: CopilotAgentId) {
    if (id === agentId && inForm) return;
    router.push(id === 'product-draft' ? '/products/new' : `/products/plans/new${productId ? `?product_id=${encodeURIComponent(productId)}` : ''}`);
  }
  function changeProduct(id: string | null) {
    router.push(`/products/plans/new${id ? `?product_id=${encodeURIComponent(id)}` : ''}`);
  }

  async function send(instruction: string) {
    if (abortRef.current || cleanupRef.current || !conversation.restored || !selection.modelId || !agentId || !agents.find(agent => agent.id === agentId)?.enabled || (agentId === 'plan-draft' && !productId)) return;
    const abort = new AbortController();
    abortRef.current = abort;
    const assistantId = crypto.randomUUID();
    const sessionId = conversation.sessionId ?? crypto.randomUUID();
    try { sessionStorage.setItem(storageKey, sessionId); } catch { setCleanupNotice('El navegador no permite conservar la conversación al recargar.'); }
    const modify = (change: Partial<CopilotMessage>) => {
      setConversations(current => {
        const previous = current[key];
        if (!previous) return current;
        return { ...current, [key]: { ...previous, messages: previous.messages.map(message => message.id === assistantId ? { ...message, ...change } : message) } };
      });
    };
    update({ sessionId, messages: [...conversation.messages, { id: crypto.randomUUID(), role: 'user', content: instruction }, { id: assistantId, role: 'assistant', content: '', status: 'running' }] });
    let output = '';
    try {
      const context = agentId === 'product-draft'
        ? { agentId, ...(conversation.currentProduct ? { currentProduct: conversation.currentProduct } : {}) }
        : { agentId, productId: productId!, ...(conversation.currentPlan ? { currentPlan: planForAgent(conversation.currentPlan) } : {}) };
      await streamCopilot({ instruction, sessionId, continueSession: conversation.messages.some(message => message.status === 'completed'), ...selection, ...context }, abort.signal, event => {
        if (abort.signal.aborted) return;
        if (event.type === 'model.output.delta' && typeof event.payload?.delta === 'string') {
          output += event.payload.delta;
          modify({ content: extractStreamingMessage(output) });
        }
        if (event.type === 'run.completed') {
          const value = event.payload?.output as { message?: string; product?: CatalogProductPayload | null; plan?: PlanDraft | null } | undefined;
          if (!value || typeof value.message !== 'string' || !(agentId === 'product-draft' ? 'product' in value : 'plan' in value)) throw new Error('Respuesta inválida.');
          modify({ content: value.message, ...(agentId === 'product-draft' && value.product ? { product: value.product } : {}), ...(agentId === 'plan-draft' && value.plan ? { plan: value.plan } : {}), status: 'completed' });
        }
        if (event.type === 'run.failed') modify({ content: typeof event.payload?.message === 'string' ? event.payload.message : 'No se pudo completar la tarea.', status: 'failed' });
        if (event.type === 'run.cancelled') modify({ content: 'Respuesta detenida.', status: 'cancelled' });
      });
      if (abort.signal.aborted) modify({ content: 'Respuesta detenida.', status: 'cancelled' });
    } catch (error) {
      if (abort.signal.aborted) modify({ content: 'Respuesta detenida.', status: 'cancelled' });
      else {
        if (error instanceof ApiError && error.status === 401) redirectToLogin();
        modify({ content: apiErrorMessage(error, 'No se pudo completar la tarea. Inténtalo de nuevo.'), status: 'failed' });
      }
    } finally { if (abortRef.current === abort) abortRef.current = null; }
  }

  return {
    key, productId, changeProduct, inForm,
    productContext: { draft: conversation.productDraft ?? null, currentProduct: conversation.currentProduct ?? null, setCurrentProduct, clear },
    planContext: { draft: conversation.planDraft ?? null, currentPlan: conversation.currentPlan ?? null, setCurrentPlan, clear },
    chat: {
      messages: conversation.messages, agents, agentId, onAgentChange: changeAgent,
      onReset: () => { if (!abortRef.current) void discard(false); },
      cleaning, cleanupNotice,
      restoring: Boolean(agentId && !conversation.restored && !conversation.restoreError),
      restoreError: conversation.restoreError,
      onRetryRestore: () => setRestoreAttempt(value => value + 1),
      contextLabel: inForm ? 'Nuevo borrador' : undefined,
      onApply: inForm ? (messageId: string) => {
        const message = conversation.messages.find(item => item.id === messageId);
        if (message?.status !== 'completed') return;
        if (agentId === 'product-draft' && message.product) {
          const product = message.product;
          update({ currentProduct: product, productDraft: { id: crypto.randomUUID(), product } });
        }
        if (agentId === 'plan-draft' && message.plan) {
          const plan = message.plan;
          const currentPlan = { ...plan, prices: plan.prices.map(price => {
            const previous = conversation.currentPlan?.prices.find(item => item.code === price.code);
            return { ...price, ...(previous ? { providerPrices: previous.providerPrices, status: previous.status } : {}) };
          }) };
          update({ currentPlan, planDraft: { id: crypto.randomUUID(), plan } });
        }
      } : undefined,
      models, modelStatus, ...selection,
      onSelectionChange: (modelId: string, effort: string) => setSelection({ modelId, effort }),
      onSend: agentId && agents.find(agent => agent.id === agentId)?.enabled && (agentId !== 'plan-draft' || productId) && !cleaning && conversation.restored ? send : undefined,
      onCancel: () => abortRef.current?.abort(),
      sendDisabledReason: agentId === 'plan-draft' && !productId ? 'Selecciona un producto para preparar su plan.' : agentId ? 'El agente no está disponible. Vuelve a abrir MIA para reintentar.' : 'Selecciona una tarea para comenzar.',
    },
  };
}
