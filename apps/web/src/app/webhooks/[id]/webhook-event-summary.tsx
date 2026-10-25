import { formatDate } from "../webhook-display";

const summaryFields = [
  { key: "eventCreatedAt", label: "Evento creado", date: true },
  { key: "resourceType", label: "Tipo de recurso" },
  { key: "resourceStatus", label: "Estado del recurso" },
  { key: "planId", label: "ID del plan" },
  { key: "resourceCreatedAt", label: "Recurso creado", date: true },
  { key: "resourceUpdatedAt", label: "Recurso actualizado", date: true },
  { key: "subscriptionStartedAt", label: "Inicio de suscripción", date: true },
  { key: "amount", label: "Importe" },
  { key: "currency", label: "Moneda" },
] as const;

export function WebhookEventSummary({ summary }: { summary: Record<string, string> }) {
  const fields = summaryFields.filter(({ key }) => summary[key]);
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm" aria-labelledby="webhook-summary-title">
      <h2 id="webhook-summary-title" className="text-lg font-bold">Resumen del evento</h2>
      {fields.length ? (
        <dl className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {fields.map((field) => (
            <div key={field.key} className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
              <dd className="mt-1 break-all text-sm font-semibold">{"date" in field ? formatDate(summary[field.key]) : summary[field.key]}</dd>
            </div>
          ))}
        </dl>
      ) : <p className="mt-3 text-sm text-muted-foreground">Este evento no contiene datos adicionales para el resumen.</p>}
    </section>
  );
}
