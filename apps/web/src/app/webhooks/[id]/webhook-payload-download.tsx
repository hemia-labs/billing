"use client";

import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { Download, Eye, EyeOff } from "lucide-react";
import { useHasPermission } from "@/components/auth-gate";
import { Button } from "@/components/zuno/button";
import { Input } from "@/components/zuno/input";
import { Label } from "@/components/zuno/label";
import { Textarea } from "@/components/zuno/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/zuno/dialog";
import { ApiError, redirectToLogin } from "@/lib/api";
import { requestWebhookPayload, saveWebhookPayload } from "./webhook-payload-api";

export function WebhookPayloadDownload({ id }: { id: string }) {
  const canRead = useHasPermission("billing.webhooks.read");
  const canRetry = useHasPermission("billing.webhooks.retry");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => { requestRef.current?.abort(); }, []);

  function changeOpen(next: boolean) {
    if (!next) {
      requestRef.current?.abort();
      requestRef.current = null;
      formRef.current?.reset();
      setBusy(false);
    }
    setError("");
    setMessage("");
    setOpen(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestRef.current) return;
    const form = event.currentTarget;
    const passwordInput = form.elements.namedItem("password") as HTMLInputElement;
    const reasonInput = form.elements.namedItem("reason") as HTMLTextAreaElement;
    const reason = reasonInput.value.trim();
    if (!passwordInput.value || !reason || reason.length > 250) {
      setError("Ingresa tu contraseña y un motivo de hasta 250 caracteres.");
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    const request = requestWebhookPayload(id, passwordInput.value, reason, controller.signal);
    passwordInput.value = "";
    try {
      const blob = await request;
      if (controller.signal.aborted) return;
      saveWebhookPayload(blob);
      form.reset();
      setOpen(false);
      setMessage("Descarga iniciada. Guarda el archivo en un lugar seguro.");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        form.reset();
        redirectToLogin();
        return;
      }
      setError(error instanceof ApiError ? error.message : "No se pudo descargar el archivo. Intenta de nuevo.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  }

  if (!canRead || !canRetry) return null;

  return (
    <div>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger render={<Button variant="outline" />}><Download className="size-4" />Descargar JSON</DialogTrigger>
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>Descargar datos originales del webhook</DialogTitle>
            <DialogDescription>El archivo contiene información sensible. Confirma tu contraseña e indica el motivo. La descarga quedará registrada en auditoría.</DialogDescription>
          </DialogHeader>
          <WebhookPayloadDownloadForm formRef={formRef} busy={busy} error={error} onSubmit={submit} onCancel={() => changeOpen(false)} />
        </DialogContent>
      </Dialog>
      {message ? <p role="status" className="mt-2 max-w-sm text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}

export function WebhookPayloadDownloadForm({ formRef, busy, error, onSubmit, onCancel }: {
  formRef?: RefObject<HTMLFormElement | null>;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form ref={formRef} onReset={() => setShowPassword(false)} onSubmit={(event) => { setShowPassword(false); onSubmit(event); }} className="mt-5 space-y-4" aria-busy={busy}>
      <div className="space-y-2">
        <Label htmlFor="webhook-download-password">Contraseña</Label>
        <div className="relative">
          <Input id="webhook-download-password" name="password" type={showPassword ? "text" : "password"} className="pr-10" autoComplete="current-password" maxLength={1024} required disabled={busy} aria-describedby={error ? "webhook-download-error" : undefined} />
          <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2" disabled={busy} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} aria-controls="webhook-download-password" onClick={() => setShowPassword((visible) => !visible)}>
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="webhook-download-reason">Motivo de la descarga</Label>
        <Textarea rows={4} id="webhook-download-reason" name="reason" placeholder="Describe para qué necesitas el archivo" maxLength={250} required disabled={busy} aria-describedby="webhook-download-reason-help" />
        <p id="webhook-download-reason-help" className="text-xs text-muted-foreground">Máximo 250 caracteres. No incluyas contraseñas ni otros datos sensibles.</p>
      </div>
      {error ? <p id="webhook-download-error" role="alert" className="text-sm text-destructive">{error}</p> : null}
      {busy ? <p role="status" className="text-sm text-muted-foreground">Validando identidad y preparando descarga...</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={busy}><Download className="size-4" />{busy ? "Preparando..." : "Confirmar y descargar"}</Button>
      </DialogFooter>
    </form>
  );
}
