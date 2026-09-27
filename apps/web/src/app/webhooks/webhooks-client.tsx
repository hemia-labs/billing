"use client";

import { type FormEvent, useEffect, useState } from "react";
import { RefreshCw, RotateCcw, Search } from "lucide-react";
import { StatusBadge } from "@/components/zuno/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/zuno/select";
import { Button } from "@/components/zuno/button";
import { Input } from "@/components/zuno/input";
import { useHasPermission } from "@/components/auth-gate";
import {
  ApiError,
  apiErrorMessage,
  apiFetch,
  redirectToLogin,
  toQueryString,
} from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ProcessingStatus = "pending" | "processed" | "failed" | "ignored";
type VerificationStatus = "verified" | "failed";
type WebhookEvent = {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  resourceId: string | null;
  verificationStatus: VerificationStatus;
  processingStatus: ProcessingStatus;
  errorMessage: string | null;
  receivedAt: string;
  processedAt: string | null;
};
type Filters = {
  provider: string;
  event_type: string;
  processing_status: "" | ProcessingStatus;
  verification_status: "" | VerificationStatus;
  provider_event_id: string;
  resource_id: string;
  received_from: string;
  received_to: string;
};

const emptyFilters: Filters = {
  provider: "",
  event_type: "",
  processing_status: "",
  verification_status: "",
  provider_event_id: "",
  resource_id: "",
  received_from: "",
  received_to: "",
};

const statusTone: Record<ProcessingStatus, "warning" | "success" | "error" | "neutral"> = {
  pending: "warning",
  processed: "success",
  failed: "error",
  ignored: "neutral",
};

export function WebhooksClient() {
  const canRetry = useHasPermission("billing.webhooks.retry");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadEvents = async (nextFilters = filters) => {
    setLoading(true);
    setMessage("");
    try {
      const page = await apiFetch<{ items?: WebhookEvent[] }>(
        `/billing/console/webhooks${toQueryString(nextFilters)}`,
      );
      setEvents(page.items ?? []);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setMessage(apiErrorMessage(error, "No se pudieron cargar los webhooks."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => loadEvents(emptyFilters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadEvents(filters);
  };

  const retry = async (event: WebhookEvent) => {
    const reason = window.prompt("Motivo del reintento");
    if (!reason?.trim()) return;
    try {
      await apiFetch(`/billing/console/webhooks/${event.id}/retry`, {
        method: "POST",
        body: { reason },
      });
      setMessage("Webhook reintentado.");
      await loadEvents();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setMessage(
        apiErrorMessage(
          error,
          "No se pudo reintentar: firma fallida, evento no fallido o rate limit.",
        ),
      );
    }
  };

  return (
    <div className="space-y-5">
      <form className="grid gap-3 rounded-2xl border border-surface-line bg-card p-5 shadow-sm md:grid-cols-3 xl:grid-cols-8" onSubmit={submitFilters}>
        <Input aria-label="Proveedor" placeholder="Proveedor" value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })} />
        <Input aria-label="Tipo" placeholder="Tipo" value={filters.event_type} onChange={(e) => setFilters({ ...filters, event_type: e.target.value })} />
        <Input aria-label="Provider event ID" placeholder="Provider event ID" value={filters.provider_event_id} onChange={(e) => setFilters({ ...filters, provider_event_id: e.target.value })} />
        <Input aria-label="Resource ID" placeholder="Resource ID" value={filters.resource_id} onChange={(e) => setFilters({ ...filters, resource_id: e.target.value })} />
        <Select value={filters.processing_status || "all"} onValueChange={(value) => setFilters({ ...filters, processing_status: (value === "all" ? "" : value) as Filters["processing_status"] })}>
          <SelectTrigger aria-label="Procesamiento"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Procesamiento</SelectItem>
            <SelectItem value="pending">Pendiente</SelectItem>
            <SelectItem value="processed">Procesado</SelectItem>
            <SelectItem value="failed">Fallido</SelectItem>
            <SelectItem value="ignored">Ignorado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.verification_status || "all"} onValueChange={(value) => setFilters({ ...filters, verification_status: (value === "all" ? "" : value) as Filters["verification_status"] })}>
          <SelectTrigger aria-label="Verificación"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Verificación</SelectItem>
            <SelectItem value="verified">Verificado</SelectItem>
            <SelectItem value="failed">Firma fallida</SelectItem>
          </SelectContent>
        </Select>
        <Input aria-label="Recibido desde" type="date" value={filters.received_from} onChange={(e) => setFilters({ ...filters, received_from: e.target.value })} />
        <Button className="gap-2" type="submit"><Search className="size-4" />Filtrar</Button>
      </form>

      {message ? <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm font-medium shadow-sm">{message}</div> : null}

      <section className="rounded-2xl border border-surface-line bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold">Eventos webhook</h2>
          <Button aria-label="Recargar webhooks" onClick={() => void loadEvents()} size="icon" variant="outline"><RefreshCw className="size-4" /></Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Evento</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Fechas</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5}>Cargando webhooks...</TableCell></TableRow>
            ) : events.length === 0 ? (
              <TableRow><TableCell colSpan={5}>No hay webhooks para mostrar.</TableCell></TableRow>
            ) : events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <div className="font-semibold">{event.eventType}</div>
                  <div className="text-xs text-muted-foreground">{event.provider} · {event.providerEventId}</div>
                  <div className="text-xs text-muted-foreground">Resource {event.resourceId ?? "sin referencia"}</div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={statusTone[event.processingStatus]}>{event.processingStatus}</StatusBadge>
                  <div className="mt-2 text-xs text-muted-foreground">{event.verificationStatus === "failed" ? "Firma fallida" : "Verificado"}</div>
                </TableCell>
                <TableCell className="max-w-72 truncate text-xs text-muted-foreground">{event.errorMessage ?? "Sin error"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>Recibido {formatDate(event.receivedAt)}</div>
                  <div>Procesado {event.processedAt ? formatDate(event.processedAt) : "pendiente"}</div>
                </TableCell>
                <TableCell className="text-right">
                  {canRetry && event.verificationStatus === "verified" && event.processingStatus === "failed" ? (
                    <Button onClick={() => void retry(event)} size="sm" variant="outline"><RotateCcw className="size-4" />Reintentar</Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">No reintentable</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
