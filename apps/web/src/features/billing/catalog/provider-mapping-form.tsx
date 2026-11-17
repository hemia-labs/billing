"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import { Alert } from "@/components/zuno/alert";
import { Button } from "@/components/zuno/button";
import { Input } from "@/components/zuno/input";
import type { BillingProvider, CatalogProviderPricePayload, CatalogPlanPricePayload, ProviderConnectionScope } from "./catalog-api";
import { ProviderConnectionField, type ConnectionBinding, type ProviderConnectionOptions } from "./provider-connection-options";

export function prepareProviderMapping(values: ConnectionBinding & { provider: BillingProvider; providerPriceId: string; providerProductId: string }) {
  if (values.connectionScope === "unassigned") return { error: "Selecciona la conexión a la que pertenecen los IDs." };
  if (values.connectionScope === "connection" && !values.providerConnectionId) return { error: "Selecciona una conexión PayPal válida." };
  if (!values.providerPriceId.trim() || values.providerPriceId.trim().length > 150) return { error: "Escribe el ID del plan o precio del proveedor (hasta 150 caracteres)." };
  if (values.providerProductId.trim().length > 150) return { error: "El ID de producto no puede superar 150 caracteres." };
  const payload: CatalogProviderPricePayload = { provider: values.provider, connectionScope: values.connectionScope, providerConnectionId: values.connectionScope === "connection" ? values.providerConnectionId : null, providerPriceId: values.providerPriceId.trim(), providerProductId: values.providerProductId.trim() || null, status: "active" };
  return { payload };
}

export function ProviderMappingForm({ options, onSave, onCancel, provider = "paypal" }: { options: ProviderConnectionOptions; onSave: (payload: CatalogProviderPricePayload) => Promise<void>; onCancel: () => void; provider?: BillingProvider }) {
  const prefix = useId();
  const [binding, setBinding] = useState<ConnectionBinding>({ connectionScope: "unassigned", providerConnectionId: null });
  const [providerPriceId, setPriceId] = useState("");
  const [providerProductId, setProductId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const result = prepareProviderMapping({ ...binding, provider, providerPriceId, providerProductId });
    if (result.error || !result.payload) { setError(result.error ?? "Revisa los datos."); return; }
    submitting.current = true; setSaving(true); setError("");
    try { await onSave(result.payload); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo vincular el plan."); } finally { submitting.current = false; setSaving(false); }
  };
  return (
    <form className="space-y-4 border-t border-border pt-4" noValidate onSubmit={submit}>
      <ProviderConnectionField binding={binding} disabled={saving} id={prefix + "-connection"} onChange={setBinding} options={options} provider={provider} />
      <label className="grid gap-2 text-sm font-medium" htmlFor={prefix + "-price"}>{provider === "paypal" ? "ID del plan en PayPal" : "ID del precio en el proveedor"}<Input disabled={saving} id={prefix + "-price"} maxLength={150} onChange={(event) => setPriceId(event.target.value)} required value={providerPriceId} /></label>
      <label className="grid gap-2 text-sm font-medium" htmlFor={prefix + "-product"}>ID de producto en {provider === "paypal" ? "PayPal" : "el proveedor"} (opcional)<Input disabled={saving} id={prefix + "-product"} maxLength={150} onChange={(event) => setProductId(event.target.value)} value={providerProductId} /></label>
      {error ? <Alert role="alert" variant="destructive">{error}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-2"><Button disabled={saving} onClick={onCancel} type="button" variant="outline">Cancelar</Button><Button disabled={saving || provider === "paypal" && (options.loading || Boolean(options.error))} type="submit">{saving ? "Guardando…" : provider === "paypal" ? "Vincular plan" : "Vincular precio"}</Button></div>
    </form>
  );
}

export function validatePlanProviderMappings(prices: Array<Omit<CatalogPlanPricePayload, "providerPrices"> & { providerPrices: Array<Omit<CatalogProviderPricePayload, "connectionScope"> & { connectionScope?: ProviderConnectionScope }> }>) {
  for (const [priceIndex, price] of prices.entries()) {
    const active = new Set<string>();
    for (const [mappingIndex, mapping] of price.providerPrices.entries()) {
      const location = `Precio ${price.code || priceIndex + 1}, vinculación ${mappingIndex + 1}: `;
      if (!mapping.connectionScope || mapping.connectionScope === "unassigned") return location + "Selecciona explícitamente la conexión antes de guardar una nueva versión. La asociación anterior se conserva y no se convierte a global automáticamente.";
      const validated = prepareProviderMapping({ provider: mapping.provider, connectionScope: mapping.connectionScope, providerConnectionId: mapping.providerConnectionId, providerPriceId: mapping.providerPriceId ?? "", providerProductId: mapping.providerProductId ?? "" });
      if (validated.error) return location + validated.error;
      const key = [mapping.provider, mapping.connectionScope, mapping.providerConnectionId ?? "global"].join(":");
      if ((mapping.status ?? "active") === "active") {
        if (active.has(key)) return location + "Sólo puede haber un plan activo vinculado por proveedor y conexión en cada precio. Archiva el anterior antes de agregar su reemplazo.";
        active.add(key);
      }
    }
  }
  return null;
}
