"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/zuno/alert";
import { Badge } from "@/components/zuno/badge";
import { Button } from "@/components/zuno/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/zuno/dialog";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import type { CatalogProduct } from "../../catalog/catalog-api";
import { activateProductPaypalConnection, getProductPaypalConnection, paypalConnectionError, type ProductPaypalConnectionPayload, type ProductPaypalConnectionState, saveProductPaypalConnection, setProductPaypalConnectionStatus } from "./paypal-connection-api";
import { PaypalConnectionForm } from "./paypal-connection-form";
import { PaypalConnectionHistory } from "./paypal-connection-history";

export function PaypalProductConnection({ product, canManage, onSaved, onSavingChange, busy = false }: { product: CatalogProduct; canManage: boolean; busy?: boolean; onSaved?: (data: ProductPaypalConnectionState) => void; onSavingChange?: (saving: boolean) => void }) {
  const [data, setData] = useState<ProductPaypalConnectionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(true);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<"activate" | "status" | null>(null);
  const [actionError, setActionError] = useState("");
  const [mutating, setMutating] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setData(null);
      setError("");
      try {
        const next = await getProductPaypalConnection(product.id, controller.signal);
        if (!controller.signal.aborted) setData(next);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; }
        setError(apiErrorMessage(cause, "No se pudo cargar la conexión PayPal."));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    });
    return () => controller.abort();
  }, [product.id, retry]);
  const accept = (next: ProductPaypalConnectionState) => {
    setData(next);
    setRevision((value) => value + 1);
    onSaved?.(next);
  };
  const save = async (payload: ProductPaypalConnectionPayload) => {
    onSavingChange?.(true);
    try {
      accept(await saveProductPaypalConnection(product.id, payload));
      setEditing(true);
      setNotice("");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; }
      throw cause;
    } finally { onSavingChange?.(false); }
  };
  const confirm = async () => {
    if (!action || !data || !canManage || submitting.current) return;
    submitting.current = true;
    setMutating(true);
    setActionError("");
    onSavingChange?.(true);
    try {
      if (action === "activate" && data.draft) {
        accept(await activateProductPaypalConnection(product.id, data.draft.id, {
          expectedUpdatedAt: data.draft.updatedAt,
          expectedCurrentConnectionId: data.connection?.id ?? null,
          expectedCurrentUpdatedAt: data.connection?.updatedAt ?? null,
        }));
        setEditing(false);
        setNotice("");
      } else if (action === "status" && data.connection) {
        accept(await setProductPaypalConnectionStatus(product.id, data.connection.id, !data.connection.enabled));
        setNotice(data.connection.enabled ? "Conexión vigente deshabilitada." : "Conexión vigente habilitada.");
      }
      setAction(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; }
      setActionError(paypalConnectionError(cause));
    } finally { submitting.current = false; setMutating(false); onSavingChange?.(false); }
  };
  const connection = data?.connection;
  const draft = data?.draft;
  const choose = (next: "activate" | "status") => { setActionError(""); setAction(next); };
  return (
    <section className="space-y-4">
      {loading ? <p className="text-sm text-muted-foreground" role="status">Cargando conexión PayPal…</p> : error ? <Alert role="alert" variant="destructive"><span className="min-w-0 flex-1">{error}</span><Button onClick={() => setRetry((value) => value + 1)} type="button" variant="outline">Reintentar</Button></Alert> : data ? <>
        {notice ? <Alert role="status" variant="success">{notice}</Alert> : null}
        <div className="space-y-3 border-b border-border pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Conexión vigente</h2>{connection && canManage ? <Button disabled={busy || (!connection.enabled && !data.encryptionConfigured)} onClick={() => choose("status")} type="button" variant="outline">{connection.enabled ? "Desactivar" : "Reactivar"}</Button> : null}</div>
          {connection ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{connection.name}</span><Badge variant="outline">{connection.environment === "live" ? "Producción" : "Sandbox"}</Badge><Badge variant="outline">{connection.enabled ? "Habilitada" : "Deshabilitada"}</Badge></div> : <p className="text-sm text-muted-foreground">Global heredada · disponibilidad no verificada</p>}
        </div>
        {!data.encryptionConfigured ? <Alert role="status">El servidor debe habilitar el almacenamiento seguro antes de guardar credenciales.</Alert> : null}
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{draft ? "Borrador" : "Nueva conexión"}</h2>{!editing && canManage ? <Button disabled={busy || !data.encryptionConfigured} onClick={() => setEditing(true)} type="button" variant="outline">{draft ? "Retomar borrador" : "Preparar borrador"}</Button> : null}</div>
        {editing && canManage && data.encryptionConfigured ? <PaypalConnectionForm busy={busy} current={connection ?? null} draft={draft ?? null} key={(draft?.id ?? "new") + ":" + (draft?.updatedAt ?? connection?.updatedAt ?? "")} onActivate={() => choose("activate")} onCancel={() => setEditing(false)} onSave={save} productName={product.name} /> : draft ? <p className="text-sm text-muted-foreground">{draft.name} · pendiente de activar</p> : <p className="text-sm text-muted-foreground">Guardar un borrador no cambia la conexión vigente.</p>}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">Ayuda sobre planes y credenciales</summary><p className="mt-2">Los IDs PayPal de los precios deben pertenecer a la app y entorno que actives. Sólo hay una conexión vigente por producto. Los contratos anteriores conservan su app.</p></details>
        <PaypalConnectionHistory busy={busy} canManage={canManage} onSavingChange={onSavingChange} productId={product.id} revision={revision} />
      </> : null}
      <Dialog dismissible={!mutating} onOpenChange={(open) => { if (!open && !mutating) setAction(null); }} open={action !== null}>
        <DialogContent showClose={!mutating}>
          <DialogHeader><DialogTitle>{action === "activate" ? "Activar conexión PayPal" : connection?.enabled ? "Desactivar conexión vigente" : "Reactivar conexión vigente"}</DialogTitle><DialogDescription className="break-words">{action === "activate" ? `«${draft?.name}» reemplazará ${connection ? "«" + connection.name + "»" : "la conexión global heredada"} para nuevas contrataciones de ${product.name}. Las suscripciones existentes conservan su app.` : `Se ${connection?.enabled ? "deshabilitarán" : "habilitarán"} nuevas contrataciones con la conexión vigente. El borrador no cambia.`}</DialogDescription></DialogHeader>
          {actionError ? <Alert className="mt-4" role="alert" variant="destructive">{actionError}</Alert> : null}
          <DialogFooter><Button disabled={mutating} onClick={() => setAction(null)} type="button" variant="outline">Cancelar</Button>{actionError ? <Button disabled={mutating} onClick={() => { setAction(null); setRetry((value) => value + 1); }} type="button" variant="outline">Actualizar datos</Button> : null}<Button disabled={mutating} onClick={() => void confirm()} type="button">{mutating ? "Procesando…" : action === "activate" ? "Activar y reemplazar" : "Confirmar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
