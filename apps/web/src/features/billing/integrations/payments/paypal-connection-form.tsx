"use client";

import { type FormEvent, useRef, useState } from "react";
import { Save } from "lucide-react";
import { Alert } from "@/components/zuno/alert";
import { Button } from "@/components/zuno/button";
import { Input } from "@/components/zuno/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/zuno/select";
import type { ProductPaypalConnection, ProductPaypalConnectionPayload } from "./paypal-connection-api";
import { PaypalWebhookInfo } from "./paypal-webhook-info";

type ConnectionValues = ProductPaypalConnectionPayload & { clientSecret: string };
type Field = "name" | "clientId" | "clientSecret" | "webhookId";

export function preparePaypalConnection(values: ConnectionValues, draft: ProductPaypalConnection | null, current: ProductPaypalConnection | null = null) {
  const errors: Partial<Record<Field, string>> = {};
  const payload: ProductPaypalConnectionPayload = {
    name: values.name.trim(), environment: values.environment, clientId: values.clientId.trim(),
    webhookId: values.webhookId.trim(),
    ...(draft ? { draftId: draft.id, expectedUpdatedAt: draft.updatedAt } : {}),
    ...(values.clientSecret ? { clientSecret: values.clientSecret } : {}),
  };
  if (!payload.name || payload.name.length > 120) errors.name = "Escribe un nombre de hasta 120 caracteres.";
  if (!payload.clientId || payload.clientId.length > 255) errors.clientId = "Escribe el Client ID de PayPal (hasta 255 caracteres).";
  const secretSource = [draft, current].find((connection) => connection?.clientId === payload.clientId && connection.environment === payload.environment);
  if (!secretSource?.hasClientSecret && !values.clientSecret) errors.clientSecret = "Escribe el Client secret de esta app de PayPal.";
  if (values.clientSecret.length > 2048) errors.clientSecret = "El Client secret no puede superar 2048 caracteres.";
  if (payload.webhookId.length > 255) errors.webhookId = "El Webhook ID no puede superar 255 caracteres.";
  return { payload, errors };
}

export function PaypalConnectionForm({ draft, current, productName, onSave, onCancel, onActivate, busy = false }: {
  draft: ProductPaypalConnection | null;
  current: ProductPaypalConnection | null;
  busy?: boolean;
  onActivate: () => void;
  productName: string;
  onSave: (payload: ProductPaypalConnectionPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const initial = draft ?? current;
  const [values, setValues] = useState<ConnectionValues>({
    name: initial?.name ?? (productName + " · PayPal").slice(0, 120),
    environment: initial?.environment ?? "sandbox", clientId: initial?.clientId ?? "",
    clientSecret: "", webhookId: initial?.webhookId ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const newApp = !draft || draft.clientId !== values.clientId.trim() || draft.environment !== values.environment;
  const source = [draft, current].find((connection) => connection?.clientId === values.clientId.trim() && connection.environment === values.environment);
  const secretRequired = !source?.hasClientSecret;
  const dirty = !draft || values.name.trim() !== draft.name || values.environment !== draft.environment || values.clientId.trim() !== draft.clientId || values.webhookId.trim() !== draft.webhookId || Boolean(values.clientSecret);
  const pending = saving || busy;
  const change = (field: Field, value: string) => {
    setValues((current) => field === "clientId" ? { ...current, clientId: value, clientSecret: "", webhookId: "" } : { ...current, [field]: value });
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || busy) return;
    const { payload, errors: nextErrors } = preparePaypalConnection(values, draft, current);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      event.currentTarget.querySelector<HTMLInputElement>("#paypal-" + Object.keys(nextErrors)[0])?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(payload);
      setValues((current) => ({ ...current, clientSecret: "" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la conexión.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  const input = (field: Field, label: string, maxLength: number, required = true) => (
    <label className="grid min-w-0 gap-2 text-sm font-medium" htmlFor={`paypal-${field}`}>
      {label}
      <Input
        aria-describedby={errors[field] ? `paypal-${field}-error` : field === "clientSecret" ? "paypal-secret-help" : undefined}
        aria-invalid={Boolean(errors[field])}
        autoComplete={field === "clientSecret" ? "new-password" : "off"}
        disabled={pending}
        id={`paypal-${field}`} maxLength={maxLength} name={field}
        onChange={(event) => change(field, event.target.value)} required={required}
        placeholder={field === "clientSecret" ? secretRequired ? "Ingresa el secreto de la app" : "Secreto guardado" : undefined}
        type={field === "clientSecret" ? "password" : "text"} value={values[field]}
      />
      {errors[field] ? <span className="text-xs font-normal text-destructive" id={`paypal-${field}-error`}>{errors[field]}</span> : null}
    </label>
  );

  return (
    <form className="mt-5 space-y-5" noValidate onSubmit={submit}>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {input("name", "Nombre de la conexión", 120)}
        <label className="grid gap-2 text-sm font-medium" htmlFor="paypal-environment">
          Entorno
          <Select disabled={pending} onValueChange={(value) => setValues((current) => ({ ...current, environment: value === "live" ? "live" : "sandbox", clientSecret: "", webhookId: "" }))} value={values.environment}>
            <SelectTrigger className="w-full" id="paypal-environment"><SelectValue>{(value: string | null) => value === "live" ? "Producción" : "Sandbox (pruebas)"}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="sandbox">Sandbox (pruebas)</SelectItem><SelectItem value="live">Producción</SelectItem></SelectContent>
          </Select>
        </label>
      </div>
      {input("clientId", "Client ID", 255)}
      <div className="space-y-2">
        {input("clientSecret", "Client secret" + (secretRequired ? "" : " (opcional)"), 2048, secretRequired)}
        <p className="text-xs text-muted-foreground" id="paypal-secret-help">{secretRequired ? "Se guarda de forma segura y no vuelve a mostrarse." : "Deja este campo vacío para conservarlo."}</p>
      </div>
      {newApp ? (
        <Alert role="status">Guardar el borrador conserva la conexión vigente. El reemplazo se realiza al activar.</Alert>
      ) : null}
      {!newApp && draft ? <>
      <PaypalWebhookInfo path={draft.webhookPath} />
      {input("webhookId", "Webhook ID (opcional para guardar)", 255, false)}
      </> : null}
      {error ? <Alert role="alert" variant="destructive">{error}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
        <Button disabled={pending} onClick={() => { setValues((current) => ({ ...current, clientSecret: "" })); onCancel(); }} type="button" variant="outline">Cancelar</Button>
        <Button disabled={pending} type="submit" variant={draft ? "outline" : "default"}><Save aria-hidden="true" className="size-4" />{saving ? "Guardando…" : "Guardar borrador"}</Button>
        {draft ? <Button aria-describedby="paypal-activation-help" disabled={pending || dirty || !draft.webhookId.trim()} onClick={onActivate} type="button">Activar conexión</Button> : null}
      </div>
      {draft ? <p className="text-xs text-muted-foreground" id="paypal-activation-help">{dirty ? "Guarda los cambios antes de activar." : !draft.webhookId.trim() ? "Añade y guarda el Webhook ID para activar." : "La activación reemplaza la conexión vigente para nuevas contrataciones."}</p> : null}
    </form>
  );
}
