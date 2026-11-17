"use client";

import { type FormEvent, useRef, useState } from "react";
import { Alert } from "@/components/zuno/alert";
import { Button } from "@/components/zuno/button";
import { Input } from "@/components/zuno/input";
import type { PaypalCredentialRotation, ProductPaypalConnection } from "./paypal-connection-api";

export function PaypalCredentialRotationForm({ connection, onSave, onCancel }: {
  connection: ProductPaypalConnection;
  onSave: (payload: PaypalCredentialRotation) => Promise<void>;
  onCancel: () => void;
}) {
  const [clientSecret, setClientSecret] = useState("");
  const [webhookId, setWebhookId] = useState(connection.webhookId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave({ clientSecret, ...(webhookId.trim() && webhookId.trim() !== connection.webhookId ? { webhookId: webhookId.trim() } : {}) });
      setClientSecret("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron actualizar las credenciales.");
    } finally { submitting.current = false; setSaving(false); }
  };
  return (
    <form className="mt-5 space-y-5" onSubmit={submit}>
      <label className="grid gap-2 text-sm font-medium" htmlFor="paypal-history-secret">
        Nuevo Client secret
        <Input autoComplete="new-password" disabled={saving} id="paypal-history-secret" maxLength={2048} name="clientSecret" onChange={(event) => setClientSecret(event.target.value)} required type="password" value={clientSecret} />
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="paypal-history-webhook">
        Webhook ID (opcional)
        <Input aria-describedby="paypal-history-webhook-help" autoComplete="off" disabled={saving} id="paypal-history-webhook" maxLength={255} name="webhookId" onChange={(event) => setWebhookId(event.target.value)} value={webhookId} />
        <span className="text-xs font-normal text-muted-foreground" id="paypal-history-webhook-help">Déjalo vacío para conservar el ID actual.</span>
      </label>
      {error ? <Alert role="alert" variant="destructive">{error}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={saving} onClick={() => { setClientSecret(""); onCancel(); }} type="button" variant="outline">Cancelar</Button>
        <Button disabled={saving} type="submit">{saving ? "Guardando…" : "Actualizar credenciales"}</Button>
      </div>
    </form>
  );
}
