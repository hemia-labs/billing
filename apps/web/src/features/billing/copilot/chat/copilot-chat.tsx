"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleDashed,
  CircleSlash2,
  CircleX,
  Plug,
  MessageSquarePlus,
  Square,
  Wrench,
  X,
} from "lucide-react";
import type { CopilotAgent, CopilotAgentId, PlanDraft } from "@/features/billing/copilot/copilot-types";
import type { CatalogProductPayload } from "@/features/billing/catalog/catalog-api";
import { azonix } from "@/app/fonts";
import { Button } from "@/components/zuno/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/zuno/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { MessageContent, type JsonValue } from "./copilot-message-content";
import { PlanProposalCard } from '../drafts/plan-proposal-card';
import styles from './copilot-chat.module.css';

type RunStatus = "running" | "completed" | "failed" | "cancelled" | "paused";
type ToolStatus = "running" | "done" | "failed" | "cancelled" | "paused";


const effortLabels: Record<string, string> = {
  "provider-default": "Auto",
  none: "Sin razonamiento",
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Muy alto",
  max: "Máximo",
};

export type CopilotMessage = {
  id: string;
  role: "user" | "assistant";
  content: JsonValue;
  product?: CatalogProductPayload;
  plan?: PlanDraft;
  proposalHref?: string;
  status?: RunStatus;
  tools?: {
    id: string;
    name: string;
    source?: string;
    kind?: "mcp" | "openapi" | "workflow" | "tool";
    status: ToolStatus;
  }[];
  attention?: {
    kind: "approval" | "input" | "wait";
    title: string;
    description?: string;
  };
};

export function CopilotChat({
  onClose,
  onReset,
  cleaning = false,
  cleanupNotice,
  restoring = false,
  restoreError,
  onRetryRestore,
  agents = [],
  agentId = null,
  onAgentChange,
  taskContext,
  contextLabel,
  onApply,
  sendDisabledReason,
  messages = [],
  models = [],
  modelStatus = "idle",
  modelId = "",
  effort = "provider-default",
  onSelectionChange,
  onSend,
  onCancel,
}: {
  onClose: () => void;
  onReset?: () => void;
  cleaning?: boolean;
  cleanupNotice?: string;
  restoring?: boolean;
  restoreError?: string;
  onRetryRestore?: () => void;
  agents?: CopilotAgent[];
  agentId?: CopilotAgentId | null;
  onAgentChange?: (id: CopilotAgentId) => void;
  taskContext?: ReactNode;
  contextLabel?: string;
  onApply?: (messageId: string) => void;
  sendDisabledReason?: string;
  messages?: CopilotMessage[];
  models?: { id: string; label: string; efforts?: string[] }[];
  modelStatus?: "idle" | "loading" | "ready" | "error";
  modelId?: string;
  effort?: string;
  onSelectionChange?: (modelId: string, effort: string) => void;
  onSend?: (message: string) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { composerRef.current?.focus(); }, []);
  const shownMessages = messages;
  const running = messages.some((message) => message.role === "assistant" && message.status === "running");
  const selectedModel = models.find((model) => model.id === modelId);
  const canSend = Boolean(onSend && modelId && draft.trim() && !running);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    void onSend?.(draft.trim());
    setDraft("");
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-foreground">
      <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h2 aria-label="MIA" className={`${azonix.className} shrink-0 text-[20px] font-semibold leading-none`}>
            MIA
          </h2>
          <p className="min-w-0 truncate border-l border-border pl-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Tu asistente en Hemia Billing</p>
        </div>
        {onReset && <Button aria-label="Nueva conversación" title="Nueva conversación" disabled={running || cleaning || messages.length === 0} onClick={() => { onReset(); setDraft(''); }} size="icon" className="size-8 shrink-0 text-muted-foreground" type="button" variant="ghost"><MessageSquarePlus className="size-3.5" aria-hidden="true" /></Button>}
        <Button aria-label="Cerrar chat de MIA" onClick={onClose} size="icon" type="button" variant="ghost">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>
      {cleanupNotice && <p role="status" className="px-4 pt-3 text-xs text-muted-foreground">{cleanupNotice}</p>}
      {restoreError && <div role="alert" className="px-4 pt-3 text-xs text-muted-foreground">{restoreError} <Button type="button" variant="link" size="sm" onClick={onRetryRestore}>Reintentar</Button></div>}

      {agentId && <p className="shrink-0 px-4 pt-3 text-[11px] font-medium text-muted-foreground" aria-label="Agente activo">
        {agents.find(agent => agent.id === agentId)?.label ?? (agentId === "product-draft" ? "Crear producto" : "Crear plan")}
        {contextLabel && <span className="font-normal"> · {contextLabel}</span>}
      </p>}

      <div aria-label="Conversación" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5" ref={conversationRef}>
        {restoring ? <p role="status" className="my-auto text-center text-xs text-muted-foreground">Recuperando conversación...</p> : shownMessages.length === 0 ? (
          <div className="my-auto px-3 py-5 text-center">
            <p className="text-sm leading-6 text-muted-foreground">
              {agentId === "plan-draft" ? "Elige un producto y describe el plan, sus precios y beneficios. Revisa la propuesta antes de guardarla." : agentId === "product-draft" ? "Describe qué ofrece y revisa la propuesta antes de guardarla." : "Selecciona una tarea para comenzar con MIA."}
            </p>
          </div>
        ) : (
          <>
            {shownMessages.map((message) => <ChatMessage key={message.id} message={message} onApply={running ? undefined : onApply} />)}
          </>
        )}
      </div>

      <form className="border-t border-border bg-card p-3" onSubmit={submit}>
        <div className="mb-3 space-y-2">
          {!contextLabel && <div className="flex flex-wrap gap-2" aria-label="Tareas de MIA">
            {agents.map(agent => <Button type="button" key={agent.id} size="sm" variant="outline" disabled={running} onClick={() => onAgentChange?.(agent.id)}>{agent.label}</Button>)}
          </div>}
          {taskContext}
        </div>
        <label className="sr-only" htmlFor="copilot-message">Mensaje para MIA</label>
        <div className="rounded-2xl border border-input bg-background p-2 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <Textarea
            className="min-h-20 max-h-40 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
            id="copilot-message"
            ref={composerRef}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={agentId === "plan-draft" ? "Describe el plan, sus precios y beneficios..." : agentId === "product-draft" ? "Describe el producto que quieres crear..." : "Elige una tarea para comenzar..."}
            rows={3}
            value={draft}
          />
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-1 pt-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Modelo de IA y esfuerzo de razonamiento"
                className="flex h-8 min-w-0 max-w-52 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/20 data-[disabled]:opacity-50"
                disabled={models.length === 0 || !onSelectionChange || running}
                type="button"
              >
                <span className="truncate">{selectedModel?.label ?? (modelStatus === "loading" ? "Cargando IA..." : models.length ? "Elegir IA" : "IA sin configurar")}</span>
                {selectedModel && <span className="shrink-0 text-muted-foreground/70">· {effortLabels[effort] ?? effort}</span>}
                <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44" side="top">
                {models.map((model) => (
                  <DropdownMenuSub key={model.id}>
                    <DropdownMenuSubTrigger className="text-xs">{model.label}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-32">
                      {(model.efforts?.length ? model.efforts : ["provider-default"]).map((availableEffort) => (
                        <DropdownMenuItem
                          className="justify-between text-xs"
                          key={availableEffort}
                          onClick={() => onSelectionChange?.(model.id, availableEffort)}
                        >
                          {effortLabels[availableEffort] ?? availableEffort}
                          {model.id === modelId && availableEffort === effort && <Check className="size-3.5" aria-hidden="true" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {running && onCancel ? (
              <Button aria-label="Detener respuesta" className="size-8 rounded-full" onClick={onCancel} size="icon" type="button">
                <Square className="size-3 fill-current" aria-hidden="true" />
              </Button>
            ) : (
              <Button aria-label="Enviar mensaje" className="size-8 rounded-full" disabled={!canSend} size="icon" type="submit">
                <ArrowUp className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
        {cleaning ? <p role="status" className="mt-2 px-1 text-xs text-muted-foreground">Limpiando conversación...</p> : !restoring && !restoreError && (modelStatus === "error" || (modelStatus === "ready" && models.length === 0) || !onSend) && (
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            {modelStatus === "error" ? "No pudimos conectar con MIA. Cierra y vuelve a abrir el chat para reintentar." : models.length === 0 && modelStatus === "ready" ? "MIA aún no tiene un modelo disponible. Contacta al administrador." : sendDisabledReason ?? "Elige qué quieres preparar para comenzar."}
          </p>
        )}
      </form>
    </div>
  );
}

function ChatMessage({ message, onApply }: { message: CopilotMessage; onApply?: (messageId: string) => void }) {
  const [applied, setApplied] = useState(false);
  const proposalAction = onApply && message.status === "completed" && (message.product || message.plan) ? (
    <div className="space-y-2.5">
      <div className="flex justify-end">
        <Button className="min-h-7 bg-blue-600 px-3 text-[11px] text-white hover:bg-blue-700" type="button" size="sm" onClick={() => { onApply(message.id); setApplied(true); }}>
          {applied ? "Volver a usar propuesta" : "Usar propuesta"}
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground" role={applied ? "status" : undefined}>
        {applied ? "Lista en el formulario. Revisa los datos y guarda cuando estés listo." : "Reemplaza los datos del formulario. Podrás revisarlos antes de guardar."}
      </p>
    </div>
  ) : null;
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[90%] rounded-2xl bg-muted px-3.5 py-2.5 text-sm leading-6 break-words">
        <MessageContent content={message.content} />
      </div>
    );
  }

  return (
    <article className="min-w-0 text-sm">
      {message.status && <RunActivity message={message} />}
      {message.content !== null && message.content !== "" && <MessageContent content={message.content} />}
      {message.product && <section aria-label="Producto propuesto" className="mt-4 overflow-hidden rounded-xl bg-muted/40">
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span>Producto propuesto</span>
            <span className="rounded-full bg-background/80 px-2 py-0.5">Sin guardar</span>
          </div>
          <div className="space-y-1.5">
            <h3 className="break-words text-base font-semibold leading-snug">{message.product.name}</h3>
            <p className="break-all font-mono text-xs text-muted-foreground" aria-label="Código del producto">{message.product.code}</p>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground/80">{message.product.description?.trim() || "Sin descripción"}</p>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Estado propuesto</span>
            <span className="font-medium">{message.product.status === "active" ? "Activo" : "Inactivo"}</span>
          </div>
        </div>
        {proposalAction && <div className="border-t border-border/50 px-4 py-3">{proposalAction}</div>}
      </section>}
      {message.plan && <PlanProposalCard plan={message.plan} action={proposalAction} />}
      {message.proposalHref && <Button className="mt-3" render={<Link href={message.proposalHref} />} variant="outline" size="sm">Revisar en formulario</Button>}
      {message.attention && <AttentionCard attention={message.attention} />}
    </article>
  );
}

function RunActivity({ message }: { message: CopilotMessage }) {
  const status = message.status;
  const tools = message.tools ?? [];
  const label = status === "running" ? message.content === "" ? "Pensando" : "Respondiendo" : status === "failed" ? "Ocurrió un error" : status === "cancelled" ? "Respuesta detenida" : status === "paused" ? "Esperando acción" : "Listo";
  const icon = status === "running" ? <PixelGridLoader /> : status === "failed" ? <CircleX className="size-3.5 text-destructive" /> : status === "cancelled" ? <CircleSlash2 className="size-3.5" /> : status === "paused" ? <CircleDashed className="size-3.5 text-amber-600" /> : <Check className="size-3.5" />;
  const summary = <span className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}{tools.length > 0 && <span>· {tools.length} {tools.length === 1 ? "herramienta" : "herramientas"}</span>}</span>;

  if (tools.length === 0) return <div className="mb-3" role="status">{summary}</div>;
  return (
    <details className="group mb-3" open={status === "running"}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{summary}</summary>
      <ol className="mt-3 space-y-2 pl-3">
        {tools.map((tool) => (
          <li className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" key={tool.id}>
            {tool.status === "failed" ? <CircleX className="size-3.5 shrink-0 text-destructive" /> : tool.status === "paused" ? <CircleDashed className="size-3.5 shrink-0 text-amber-600" /> : tool.kind === "mcp" || tool.kind === "openapi" ? <Plug className="size-3.5 shrink-0" /> : <Wrench className="size-3.5 shrink-0" />}
            <span className="min-w-0 truncate">{tool.source ? `${tool.source} · ` : ""}{tool.name}{tool.status === "running" ? " · ejecutando" : ""}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function PixelGridLoader() {
  return (
    <span aria-hidden="true" className="grid size-[15px] shrink-0 grid-cols-3 gap-[1.5px]">
      {Array.from({ length: 9 }, (_, index) => (
        <span className={`${styles.pixel} rounded-[1px] bg-[#a1a1aa] opacity-15 dark:bg-[#f4f4f5]`} key={index} style={{ animationDelay: `${(index % 3 + Math.abs(Math.floor(index / 3) - 1)) * 90}ms` }} />
      ))}
    </span>
  );
}

function AttentionCard({ attention }: { attention: NonNullable<CopilotMessage["attention"]> }) {
  const label = attention.kind === "approval" ? "Aprobación requerida" : attention.kind === "input" ? "Información necesaria" : "En espera";
  return (
    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
      <p className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400"><CircleDashed className="size-4" aria-hidden="true" />{label}</p>
      <p className="mt-2 font-medium">{attention.title}</p>
      {attention.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{attention.description}</p>}
    </div>
  );
}
