"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/zuno/alert";
import { Button } from "@/components/zuno/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/zuno/select";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import { listProductPaypalConnections, type ProductPaypalConnectionHistory } from "../integrations/payments/paypal-connection-api";
import type { BillingProvider, ProviderConnectionScope } from "./catalog-api";

export type ConnectionBinding = { connectionScope: ProviderConnectionScope; providerConnectionId: string | null };
export type ProviderConnectionOptions = { data: ProductPaypalConnectionHistory | null; loading: boolean; error: string; retry: () => void };

export function useProviderConnectionOptions(productId: string): ProviderConnectionOptions {
  const [state, setState] = useState<{ productId: string; data: ProductPaypalConnectionHistory | null; error: string }>({ productId: "", data: null, error: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setState({ productId, data: null, error: "" });
      try {
        const data = await listProductPaypalConnections(productId, controller.signal);
        if (!controller.signal.aborted) setState({ productId, data, error: "" });
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; }
        setState({ productId, data: null, error: cause instanceof ApiError && cause.status === 429 ? "Espera un momento y reintenta." : apiErrorMessage(cause, "No se pudieron consultar las conexiones PayPal.") });
      }
    });
    return () => controller.abort();
  }, [productId, revision]);
  const current = state.productId === productId ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? "", loading: Boolean(productId && !current?.data && !current?.error), retry: () => setRevision((value) => value + 1) };
}

export function providerConnectionLabel(binding: ConnectionBinding, data: ProductPaypalConnectionHistory | null) {
  if (binding.connectionScope === "global") return "Global heredada";
  if (binding.connectionScope !== "connection") return "Sin asignar · configuración antigua";
  const connection = data?.connections.find((item) => item.id === binding.providerConnectionId && !item.isDraft);
  return connection ? `${connection.name} · ${connection.environment === "live" ? "Producción" : "Sandbox"} · ${connection.isCurrent ? "Vigente" : "Anterior"}` : `Conexión ${binding.providerConnectionId ?? "no disponible"}`;
}

export function ProviderConnectionField({ binding, options, onChange, id, disabled = false, provider = "paypal" }: { provider?: BillingProvider; binding: ConnectionBinding; options: ProviderConnectionOptions; onChange: (next: ConnectionBinding) => void; id: string; disabled?: boolean }) {
  const value = binding.connectionScope === "global" ? "global" : binding.connectionScope === "connection" ? binding.providerConnectionId : null;
  const paypal = provider === "paypal";
  const connections = paypal ? options.data?.connections.filter((item) => !item.isDraft) ?? [] : [];
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor={id}>{paypal ? "Conexión PayPal" : "Ámbito de la vinculación"}</label>
      <Select disabled={disabled || paypal && (options.loading || Boolean(options.error))} onValueChange={(next) => { if (next) onChange(next === "global" ? { connectionScope: "global", providerConnectionId: null } : { connectionScope: "connection", providerConnectionId: next }); }} value={value}>
        <SelectTrigger className="w-full" id={id}><SelectValue placeholder={paypal ? "Selecciona una conexión" : "Selecciona ámbito"}>{() => value ? !paypal && value === "global" ? "Global" : providerConnectionLabel(binding, options.data) : paypal ? "Selecciona una conexión" : "Selecciona ámbito"}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value="global">{paypal ? "Global heredada" : "Global"}</SelectItem>{connections.map((connection) => <SelectItem key={connection.id} value={connection.id}>{providerConnectionLabel({ connectionScope: "connection", providerConnectionId: connection.id }, options.data)}</SelectItem>)}</SelectContent>
      </Select>
      {paypal && options.loading ? <p className="text-xs text-muted-foreground" role="status">Cargando conexiones…</p> : null}
      {paypal && options.error ? <Alert role="alert" variant="destructive"><span>{options.error}</span><Button disabled={disabled} onClick={options.retry} type="button" variant="outline">Reintentar</Button></Alert> : null}
      {binding.connectionScope === "unassigned" ? <p className="text-xs text-muted-foreground">{paypal ? "Elige explícitamente la app a la que pertenecen estos IDs. No se asigna automáticamente." : "Elige Global para asociar explícitamente estos IDs."}</p> : null}
    </div>
  );
}
