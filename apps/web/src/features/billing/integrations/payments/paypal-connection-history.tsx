"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/zuno/alert";
import { Badge } from "@/components/zuno/badge";
import { Button } from "@/components/zuno/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/zuno/dialog";
import { ApiError, apiBaseUrl, apiErrorMessage, redirectToLogin } from "@/lib/api";
import { listProductPaypalConnections, type PaypalCredentialRotation, type ProductPaypalConnection, type ProductPaypalConnectionHistory, rotateProductPaypalCredentials } from "./paypal-connection-api";
import { PaypalCredentialRotationForm } from "./paypal-credential-rotation-form";

export function PaypalConnectionHistory({ productId, canManage, revision, onSavingChange, busy = false }: { productId: string; canManage: boolean; revision: number; busy?: boolean; onSavingChange?: (saving: boolean) => void }) {
  const [data, setData] = useState<ProductPaypalConnectionHistory | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<ProductPaypalConnection | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setData(null);
      setError("");
      try {
        const next = await listProductPaypalConnections(productId, controller.signal);
        if (!controller.signal.aborted) setData(next);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; }
        setError(apiErrorMessage(cause, "No se pudieron cargar las conexiones anteriores."));
      }
    });
    return () => controller.abort();
  }, [productId, retry, revision]);
  const save = async (payload: PaypalCredentialRotation) => {
    if (!selected) return;
    setSaving(true);
    onSavingChange?.(true);
    try {
      await rotateProductPaypalCredentials(productId, selected.id, payload);
      setSelected(null);
      setNotice("Credenciales de la conexión anterior actualizadas.");
      setRetry((value) => value + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; }
      throw cause;
    } finally { setSaving(false); onSavingChange?.(false); }
  };
  if (error) return <Alert className="mt-5 flex-wrap" role="alert" variant="destructive"><span className="min-w-0 flex-1">{error}</span><Button onClick={() => setRetry((value) => value + 1)} type="button" variant="outline">Reintentar</Button></Alert>;
  if (!data) return <p className="mt-5 text-sm text-muted-foreground" role="status">Consultando conexiones anteriores…</p>;
  const previous = data.connections.filter((connection) => !connection.isCurrent && !connection.isDraft) ?? [];
  if (!previous.length) return null;
  return (
    <details className="mt-6 border-t border-border pt-5">
      <summary className="cursor-pointer font-semibold">Conexiones anteriores ({previous.length})</summary>
      <p className="mt-2 text-xs text-muted-foreground">Conservan sus contratos. Actualizar credenciales no cambia la conexión vigente.</p>
      {notice ? <Alert className="mt-4" role="status" variant="success">{notice}</Alert> : null}
      <ul className="mt-4 divide-y divide-border">
        {previous.map((connection) => (
          <li className="space-y-2 py-4" key={connection.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="break-words font-medium">{connection.name}</span><Badge variant="outline">{connection.environment === "live" ? "Producción" : "Sandbox"}</Badge></div>
              {canManage ? <Button disabled={busy || !data?.encryptionConfigured} onClick={() => { setNotice(""); setSelected(connection); }} type="button" variant="outline">Actualizar credenciales</Button> : null}
            </div>
            <p className="break-all font-mono text-xs text-muted-foreground">Client ID: {connection.clientId}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">Webhook: {new URL(connection.webhookPath, apiBaseUrl).toString()}</p>
          </li>
        ))}
      </ul>
      <Dialog dismissible={!saving} onOpenChange={(open) => { if (!open && !saving) setSelected(null); }} open={Boolean(selected && canManage)}>
        <DialogContent showClose={!saving}>
          <DialogHeader>
            <DialogTitle>Actualizar credenciales</DialogTitle>
            <DialogDescription className="break-words">{selected?.name} · {selected?.environment === "live" ? "Producción" : "Sandbox"}. Se conserva la misma app y sus contratos anteriores.</DialogDescription>
          </DialogHeader>
          {selected && canManage ? <PaypalCredentialRotationForm connection={selected} key={selected.id} onCancel={() => setSelected(null)} onSave={save} /> : null}
        </DialogContent>
      </Dialog>
    </details>
  );
}
