import { ApiError, apiBaseUrl, apiFetch } from "@/lib/api";
import type { CatalogProductPayload } from "@/features/billing/catalog/catalog-api";
import type { CopilotAgent, CopilotAgentId, PlanDraft } from './copilot-types';
import type { CopilotMessage } from './chat/copilot-chat';

export function getCopilotSession(sessionId: string, agentId: CopilotAgentId, productId: string | null, signal: AbortSignal) {
  const query = new URLSearchParams({ sessionId, agentId, ...(productId ? { productId } : {}) });
  return apiFetch<{ sessionId: string; messages: CopilotMessage[] }>(`/billing/console/copilot/sessions?${query}`, { signal, cache: 'no-store' });
}

export function deleteCopilotSession(sessionId: string, agentId: CopilotAgentId, productId: string | null) {
  return apiFetch<void>('/billing/console/copilot/sessions', {
    method: 'DELETE',
    body: JSON.stringify({ sessionId, agentId, ...(productId ? { productId } : {}) }),
    signal: AbortSignal.timeout(8000),
  });
}

export type CopilotModel = {
  id: string;
  label: string;
  efforts: string[];
};

export function listCopilotModels() {
  return apiFetch<CopilotModel[]>("/billing/console/copilot/models");
}

export function listCopilotAgents() {
  return apiFetch<CopilotAgent[]>("/billing/console/copilot/agents");
}

export type CopilotRunInput = {
  sessionId?: string;
  continueSession?: boolean;
  instruction: string;
  modelId: string;
  effort: string;
} & ({ agentId: 'product-draft'; currentProduct?: CatalogProductPayload } | { agentId: 'plan-draft'; productId: string; currentPlan?: PlanDraft });

export type CopilotRunEvent = {
  type: string;
  payload?: Record<string, unknown>;
};

export function extractStreamingMessage(output: string): string {
  const match = /"message"\s*:\s*"((?:\\["\\/bfnrt]|\\u[0-9a-fA-F]{4}|[^"\\])*)/.exec(output);
  try { return match ? JSON.parse(`"${match[1]}"`) as string : ""; } catch { return ""; }
}

export async function streamCopilot(
  input: CopilotRunInput,
  signal: AbortSignal,
  onEvent: (event: CopilotRunEvent) => void,
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/billing/console/copilot/runs/stream`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, response.status === 429 ? "Espera un momento antes de volver a intentarlo." : "No se pudo iniciar el agente. Revisa la tarea y su contexto.");
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('El servidor no devolvió un stream.');
  if (!response.body) throw new Error("La respuesta del agente no incluye un stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");
      if (buffer.length > 256000) throw new Error('La respuesta del agente es demasiado grande.');
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const eventName = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
        const data = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
        if (data) {
          const event = JSON.parse(data) as CopilotRunEvent;
          if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Evento inválido.');
          event.type ??= eventName ?? "message";
          if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled") terminal = true;
          onEvent(event);
          if (terminal) return;
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!terminal && !signal.aborted) throw new Error("El agente terminó sin responder.");
}
