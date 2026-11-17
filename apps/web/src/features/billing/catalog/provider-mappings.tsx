"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/zuno/alert";
import { Badge } from "@/components/zuno/badge";
import { Button } from "@/components/zuno/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/zuno/dialog";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import { addAddonProviderPrice, addPlanProviderPrice, listAddonProviderPrices, setAddonProviderPriceStatus, setPlanProviderPriceStatus, type BillingProvider, type CatalogProviderPrice, type CatalogProviderPricePayload } from "./catalog-api";
import { providerConnectionLabel, type ProviderConnectionOptions } from "./provider-connection-options";
import { ProviderMappingForm } from "./provider-mapping-form";

export function providerMappingError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return "Sesión expirada. Inicia sesión de nuevo.";
    if (cause.status === 403) return "No tienes permiso para administrar los planes vinculados a esta conexión.";
    if (cause.status === 404) return "No se encontró el precio, add-on o conexión seleccionada. Actualiza los datos.";
    if (cause.code === "BILLING_PROVIDER_PRICE_NOT_CONFIGURED" || cause.code === "BILLING_PROVIDER_PRICE_SCOPE_CONFLICT") return apiErrorMessage(cause, "Revisa la configuración de esta conexión.");
    if (cause.status === 409) return "Ya hay un plan activo vinculado a esa conexión o la configuración cambió. Para corregir un ID, archiva la vinculación anterior y agrega otra.";
    if (cause.status === 429) return "Demasiadas solicitudes. Espera un momento y reintenta.";
    if (cause.status >= 500) return "No se pudieron consultar los planes vinculados. Intenta de nuevo.";
    if (cause.status === 400) return "Revisa los IDs y la conexión seleccionada. Debe pertenecer al mismo producto y estar guardada como vigente o anterior.";
  }
  return "No se pudo vincular el plan. Revisa los datos y vuelve a intentarlo.";
}

export function ProviderMappings({ kind, resourceId, initialMappings, options, canManage, provider = "paypal", onChanged }: { kind: "plan" | "addon"; resourceId: string; initialMappings?: CatalogProviderPrice[]; options: ProviderConnectionOptions; canManage: boolean; provider?: BillingProvider; onChanged?: () => void }) {
  const [mappings, setMappings] = useState<CatalogProviderPrice[] | null>(initialMappings ?? null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (kind !== "addon") return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setMappings(null); setError("");
      try { const next = await listAddonProviderPrices(resourceId, controller.signal); if (!controller.signal.aborted) setMappings(next); }
      catch (cause) { if (controller.signal.aborted) return; if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; } setError(providerMappingError(cause)); }
    });
    return () => controller.abort();
  }, [kind, resourceId, revision]);
  const add = async (payload: CatalogProviderPricePayload) => {
    if (!canManage) return;
    setSaving(true);
    try {
      const next = await (kind === "plan" ? addPlanProviderPrice(resourceId, payload) : addAddonProviderPrice(resourceId, payload));
      setMappings((items) => [...(items ?? []), next]); setAdding(false); onChanged?.();
    } catch (cause) { if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; } throw new Error(providerMappingError(cause)); }
    finally { setSaving(false); }
  };
  const toggle = async (mapping: CatalogProviderPrice) => {
    if (!canManage || submitting.current || saving) return;
    submitting.current = true; setChanging(mapping.id); setError("");
    try {
      const status = mapping.status === "active" ? "archived" : "active";
      const next = await (kind === "plan" ? setPlanProviderPriceStatus(mapping.id, status) : setAddonProviderPriceStatus(mapping.id, status));
      setMappings((items) => items?.map((item) => item.id === next.id ? next : item) ?? []); onChanged?.();
    } catch (cause) { if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; } setError(providerMappingError(cause)); }
    finally { submitting.current = false; setChanging(null); }
  };
  const visibleMappings = mappings?.filter((mapping) =>
    !((!mapping.connectionScope || mapping.connectionScope === "unassigned") && !mapping.providerPriceId?.trim()),
  );
  return (
    <section className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Planes de pago vinculados</h4>{canManage ? <Button disabled={saving || Boolean(changing) || !mappings} onClick={() => setAdding(true)} size="sm" type="button" variant="outline">{provider === "paypal" ? "Vincular plan de PayPal" : "Vincular precio"}</Button> : null}</div>
      {options.error ? <Alert role="alert" variant="destructive"><span>{options.error}</span><Button disabled={saving || Boolean(changing)} onClick={options.retry} type="button" variant="outline">Reintentar conexiones</Button></Alert> : null}
      {error ? <Alert role="alert" variant="destructive"><span>{error}</span>{kind === "addon" && !mappings ? <Button onClick={() => setRevision((value) => value + 1)} type="button" variant="outline">Reintentar</Button> : null}</Alert> : null}
      {visibleMappings ? visibleMappings.length ? <ul className="divide-y divide-border">{visibleMappings.map((mapping) => <li className="flex flex-col justify-between gap-3 py-3 sm:flex-row" key={mapping.id}><div className="min-w-0 space-y-1"><p className="break-words text-sm font-medium">{mapping.provider === "paypal" ? "PayPal" : mapping.provider} · {providerConnectionLabel({ connectionScope: mapping.connectionScope ?? "unassigned", providerConnectionId: mapping.providerConnectionId ?? null }, options.data)}</p><p className="break-all font-mono text-xs text-muted-foreground">{mapping.providerPriceId ?? "Sin ID remoto"}</p>{mapping.providerProductId ? <p className="break-all text-xs text-muted-foreground">Producto: {mapping.providerProductId}</p> : null}<Badge variant="outline">{mapping.status === "active" ? "Activo" : "Archivado"}</Badge>{(!mapping.connectionScope || mapping.connectionScope === "unassigned") ? <p className="text-xs text-muted-foreground">Asociación anterior sin conexión identificada. Vincula un plan para nuevas contrataciones.</p> : null}</div>{canManage ? <Button className="shrink-0 self-start" disabled={saving || Boolean(changing)} onClick={() => void toggle(mapping)} size="sm" type="button" variant="outline">{changing === mapping.id ? "Guardando…" : mapping.status === "active" ? "Archivar" : "Reactivar"}</Button> : null}</li>)}</ul> : <p className="text-sm text-muted-foreground">Sin planes vinculados.</p> : !error ? <p className="text-sm text-muted-foreground" role="status">Cargando planes vinculados…</p> : null}
      <Dialog dismissible={!saving} onOpenChange={(open) => { if (!saving) setAdding(open); }} open={adding}><DialogContent showClose={!saving}><DialogHeader><DialogTitle>{provider === "paypal" ? "Vincular plan de PayPal" : "Vincular precio"}</DialogTitle><DialogDescription>{provider === "paypal" ? "Selecciona la conexión e ingresa el ID del plan." : "Selecciona el ámbito e ingresa el ID del precio."}</DialogDescription></DialogHeader>{adding ? <ProviderMappingForm onCancel={() => setAdding(false)} onSave={add} options={options} provider={provider} /> : null}</DialogContent></Dialog>
    </section>
  );
}
