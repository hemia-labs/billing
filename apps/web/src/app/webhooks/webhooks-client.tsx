"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Eye, Filter, MoreHorizontal, RefreshCw, RotateCcw, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { CardContent, CardFooter } from "@/components/zuno/card";
import { Alert, AlertDescription } from "@/components/zuno/alert";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/zuno/dropdown-menu";
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

import { type ProcessingStatus, type WebhookEvent, processingLabels, statusTone, formatDate } from "./webhook-display";

type Filters = {
  provider: string;
  event_type: string;
  processing_status: "" | ProcessingStatus;
  verification_status: "" | WebhookEvent["verificationStatus"];
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

export function WebhooksClient() {
  const canRetry = useHasPermission("billing.webhooks.retry");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [total, setTotal] = useState(0);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);

  const loadEvents = async (nextFilters = appliedFilters, nextPage = pageNumber) => {
    setLoading(true);
    setMessage("");
    try {
      const page = await apiFetch<{ items: WebhookEvent[]; total: number }>(
        `/billing/console/webhooks${toQueryString({ ...nextFilters, page: nextPage, limit: 10 })}`,
      );
      setEvents(page.items ?? []);
      setTotal(page.total);
      setPageNumber(nextPage);
      setAppliedFilters(nextFilters);
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
    void loadEvents(filters, 1);
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
    <>
      <CardContent className="space-y-4 p-5">
        {message ? <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert> : null}
        <form onSubmit={submitFilters} className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span aria-live="polite" className="text-sm text-muted-foreground">{loading ? "Cargando..." : `${total} ${total === 1 ? "webhook" : "webhooks"}`}</span>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Buscar por tipo de evento" className="pl-10 text-sm" placeholder="Buscar por tipo de evento" value={filters.event_type} onChange={(e) => setFilters({ ...filters, event_type: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" aria-expanded={showFilters} aria-controls="webhook-filters" onClick={() => setShowFilters(!showFilters)} className="min-w-28 px-4 font-semibold" variant="outline"><Filter className="size-4" />Filtros</Button>
                <Button type="submit" variant="outline" disabled={loading}>Buscar</Button>
                <Button type="button" aria-label="Recargar webhooks" disabled={loading} onClick={() => void loadEvents()} size="icon" variant="ghost"><RefreshCw className="size-4" /></Button>
              </div>
            </div>
          </div>
          {showFilters ? <div id="webhook-filters" className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-4">
        <Input aria-label="Proveedor" placeholder="Proveedor" value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })} />
        <Input aria-label="ID del evento" placeholder="ID del evento" value={filters.provider_event_id} onChange={(e) => setFilters({ ...filters, provider_event_id: e.target.value })} />
        <Input aria-label="ID del recurso" placeholder="ID del recurso" value={filters.resource_id} onChange={(e) => setFilters({ ...filters, resource_id: e.target.value })} />
        <Select value={filters.processing_status || "all"} onValueChange={(value) => setFilters({ ...filters, processing_status: (value === "all" ? "" : value) as Filters["processing_status"] })}>
          <SelectTrigger aria-label="Procesamiento"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="pending">Pendiente</SelectItem>
            <SelectItem value="processing">En proceso</SelectItem>
            <SelectItem value="processed">Procesado</SelectItem>
            <SelectItem value="failed">Fallido</SelectItem>
            <SelectItem value="ignored">Ignorado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.verification_status || "all"} onValueChange={(value) => setFilters({ ...filters, verification_status: (value === "all" ? "" : value) as Filters["verification_status"] })}>
          <SelectTrigger aria-label="Verificación"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las verificaciones</SelectItem>
            <SelectItem value="verified">Verificado</SelectItem>
            <SelectItem value="failed">Firma fallida</SelectItem>
          </SelectContent>
        </Select>
        <label className="grid gap-1 text-xs text-muted-foreground">Recibido desde<Input aria-label="Recibido desde" type="date" value={filters.received_from} onChange={(e) => setFilters({ ...filters, received_from: e.target.value })} /></label>
        <div className="flex items-end gap-2">
          <Button disabled={loading} type="submit">Aplicar filtros</Button>
          <Button type="button" variant="ghost" disabled={loading} onClick={() => { setFilters(emptyFilters); void loadEvents(emptyFilters, 1); }}>Limpiar</Button>
        </div>
          </div> : null}
        </form>
      </CardContent>
      <div className="border-t border-border">
        <Table className="min-w-[40rem] table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 w-[30%] px-5 text-xs font-medium text-muted-foreground">Evento</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Estado</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Recibido</TableHead>
              <TableHead className="w-16 px-5 text-right"><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell className="h-24 px-5 text-center text-muted-foreground" colSpan={4}>Cargando webhooks...</TableCell></TableRow>
            ) : events.length === 0 ? (
              <TableRow><TableCell className="h-24 px-5 text-center text-muted-foreground" colSpan={4}>No hay webhooks para mostrar.</TableCell></TableRow>
            ) : events.map((event) => (
              <TableRow className="h-[60px] hover:bg-muted/30" key={event.id}>
                <TableCell className="min-w-0 px-5">
                  <Link href={`/webhooks/${event.id}`} title={event.eventType} className="block truncate font-semibold text-foreground hover:underline">{event.eventType}</Link>
                  <div className="truncate text-xs text-muted-foreground">{event.provider} · {event.providerEventId}</div>

                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={statusTone[event.processingStatus]}>{processingLabels[event.processingStatus]}</StatusBadge>
                    {event.verificationStatus === "failed" ? <StatusBadge status="error">Firma inválida</StatusBadge> : null}
                    {event.requiresManualReview ? <StatusBadge status="warning">Revisión manual requerida</StatusBadge> : null}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(event.receivedAt)}</TableCell>
                <TableCell className="px-5 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button aria-label={`Acciones de ${event.providerEventId}`} className="size-9" size="icon" variant="ghost" />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      <DropdownMenuItem render={<Link href={`/webhooks/${event.id}`} />}><Eye className="size-4" />Ver detalle</DropdownMenuItem>
                      {canRetry && event.verificationStatus === "verified" && event.processingStatus === "failed" ? <DropdownMenuItem onClick={() => void retry(event)}><RotateCcw className="size-4" />Reintentar</DropdownMenuItem> : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <CardFooter className="flex flex-col gap-3 border-t border-border bg-card px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <span>{loading ? "Cargando..." : events.length ? `${(pageNumber - 1) * 10 + 1}–${(pageNumber - 1) * 10 + events.length} de ${total} webhooks` : `0 de ${total} webhooks`}</span>
        <nav aria-label="Paginación de webhooks" className="flex items-center gap-2">
          <Button variant="ghost" disabled={loading || pageNumber <= 1} onClick={() => void loadEvents(appliedFilters, pageNumber - 1)}><ChevronLeft className="size-4" />Anterior</Button>
          <span aria-current="page" className="rounded-lg border border-border px-3 py-1.5 text-foreground">{pageNumber}</span>
          <Button variant="ghost" disabled={loading || pageNumber * 10 >= total} onClick={() => void loadEvents(appliedFilters, pageNumber + 1)}>Siguiente<ChevronRight className="size-4" /></Button>
        </nav>
      </CardFooter>
    </>
  );
}
