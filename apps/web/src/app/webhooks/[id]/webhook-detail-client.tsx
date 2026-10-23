"use client";

import { useEffect, useState } from "react";
import { WebhookPayloadDownload } from "./webhook-payload-download";
import { WebhookEventSummary } from "./webhook-event-summary";
import { WebhookManualRetries } from "./webhook-manual-retries";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/zuno/button";
import { StatusBadge } from "@/components/zuno/status-badge";
import { ApiError, apiErrorMessage, apiFetch, redirectToLogin } from "@/lib/api";
import { type WebhookDetail, formatDate, processingLabels, statusTone } from "../webhook-display";

export function WebhookDetailClient({ id }: { id: string }) {
  const [event, setEvent] = useState<WebhookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      setEvent(null);
      try {
        const result = await apiFetch<WebhookDetail>(`/billing/console/webhooks/${encodeURIComponent(id)}`);
        if (active) setEvent(result);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setError(error instanceof ApiError && error.status === 404 ? "No se encontró este webhook." : apiErrorMessage(error, "No se pudo cargar el webhook."));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id, reload]);

  const referenceLabels: Record<string, string> = {
    id: "ID del recurso", custom_id: "Referencia personalizada", billing_agreement_id: "ID del acuerdo de facturación", subscription_id: "ID de suscripción",
  };

  return (
    <div className="space-y-5">
      <PageHeading title="Detalle de webhook" description="Consulta el estado, las referencias y los datos de procesamiento del evento." actions={event && !loading && !error ? <WebhookPayloadDownload key={id} id={id} /> : undefined} />
      {loading ? <p role="status" className="rounded-2xl border border-border bg-card p-5 text-sm">Cargando detalle del webhook...</p> : error ? (
        <div role="alert" className="space-y-3 rounded-2xl border border-border bg-card p-5"><p className="text-sm">{error}</p><Button variant="outline" onClick={() => setReload(reload + 1)}>Volver a intentar</Button></div>
      ) : event ? <>
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="min-w-0 break-all text-lg font-bold">{event.eventType}</h2>
            <StatusBadge status={statusTone[event.processingStatus]}>{processingLabels[event.processingStatus]}</StatusBadge>
          </div>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ["Proveedor", event.provider], ["ID del webhook", event.id], ["ID del evento del proveedor", event.providerEventId],
              ["ID del recurso", event.resourceId ?? "Sin referencia"], ["ID de transmisión", event.transmissionId ?? "Sin registro"],
              ["Verificación de firma", event.verificationStatus === "verified" ? "Verificado" : "Firma fallida"],
              ["Intentos de procesamiento", event.attempts], ["Revisión manual", event.requiresManualReview ? "Requerida" : "No requerida"],
              ["Recibido", formatDate(event.receivedAt)], ["Procesado", formatDate(event.processedAt)],
              ["Próximo reintento", event.processingStatus === "pending" || event.processingStatus === "failed" ? formatDate(event.nextRetryAt) : "No programado"],
              ["Bloqueo hasta", formatDate(event.lockedUntil)],
            ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 break-all text-sm font-semibold">{value}</dd></div>)}
          </dl>
        </section>
        <WebhookEventSummary summary={event.summary} />
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-bold">Resultado del procesamiento</h2>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{event.errorMessage ?? "Sin errores registrados."}</p>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-bold">Referencias del evento</h2>
          {Object.keys(event.references).length ? <dl className="mt-3 divide-y divide-border">{Object.entries(event.references).map(([key, value]) => (
            <div key={key} className="grid gap-2 py-3 sm:grid-cols-2"><dt className="text-sm text-muted-foreground">{referenceLabels[key] ?? key}</dt><dd className="break-all text-sm font-medium">{value}</dd></div>
          ))}</dl> : <p className="mt-3 text-sm text-muted-foreground">Este evento no tiene referencias asociadas.</p>}
        </section>
        <WebhookManualRetries key={id} id={id} />
      </> : null}
    </div>
  );
}
