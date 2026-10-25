"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/zuno/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, apiErrorMessage, apiFetch, redirectToLogin } from "@/lib/api";
import { type WebhookManualRetryPage, formatDate } from "../webhook-display";

export function WebhookManualRetries({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<WebhookManualRetryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      setData(null);
      try {
        const result = await apiFetch<WebhookManualRetryPage>(`/billing/console/webhooks/${encodeURIComponent(id)}/manual-retries?page=${page}&limit=10`, { signal: controller.signal, cache: "no-store" });
        if (!controller.signal.aborted) setData(result);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setError(error instanceof ApiError && error.status === 429 ? "Demasiadas solicitudes. Espera un momento e intenta de nuevo." : apiErrorMessage(error, "No se pudo cargar el historial de reintentos."));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [id, page, revision]);

  return <WebhookManualRetryHistory data={data} loading={loading} error={error} onReload={() => setRevision((value) => value + 1)} onPageChange={setPage} />;
}

export function WebhookManualRetryHistory({ data, loading, error, onReload, onPageChange }: {
  data: WebhookManualRetryPage | null;
  loading: boolean;
  error: string;
  onReload: () => void;
  onPageChange: (page: number) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-labelledby="webhook-retries-title">
      <div className="flex items-center justify-between gap-3 p-5">
        <div>
          <h2 id="webhook-retries-title" className="text-lg font-bold">Historial de reintentos manuales</h2>
          <p className="mt-1 text-xs text-muted-foreground">Solicitudes de la más reciente a la más antigua. El número de intento corresponde a una ventana de 15 minutos.</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Recargar historial de reintentos" disabled={loading} onClick={onReload}><RefreshCw className="size-4" /></Button>
      </div>
      {error ? <div role="alert" className="space-y-3 border-t border-border p-5"><p className="text-sm">{error}</p><Button variant="outline" onClick={onReload}>Volver a intentar</Button></div> : (
        <>
          <div className="border-t border-border" aria-busy={loading}>
            <Table className="min-w-[40rem]">
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="px-5">Fecha</TableHead><TableHead>Usuario</TableHead><TableHead>Intento en 15 min</TableHead><TableHead className="px-5">Motivo</TableHead></TableRow></TableHeader>
              <TableBody>
                {loading ? <TableRow><TableCell colSpan={4} className="h-24 px-5 text-center text-muted-foreground"><span role="status">Cargando reintentos manuales...</span></TableCell></TableRow> : !data?.items.length ? <TableRow><TableCell colSpan={4} className="h-24 px-5 text-center text-muted-foreground">No hay reintentos manuales registrados para este webhook.</TableCell></TableRow> : data.items.map((retry) => (
                  <TableRow key={retry.id}>
                    <TableCell className="whitespace-nowrap px-5 text-xs text-muted-foreground">{formatDate(retry.createdAt)}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal break-all text-xs">{retry.actorUserId ?? "Usuario no disponible"}</TableCell>
                    <TableCell className="tabular-nums">{retry.attempt ?? "Sin registro"}</TableCell>
                    <TableCell className="max-w-96 whitespace-pre-wrap break-words px-5 text-sm">{retry.reason ?? "Sin motivo registrado"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data && data.total > 0 ? <div className="flex flex-col gap-3 border-t border-border px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{data.items.length ? `${(data.page - 1) * data.limit + 1}–${(data.page - 1) * data.limit + data.items.length}` : "0"} de {data.total} reintentos</span>
            <nav aria-label="Paginación de reintentos manuales" className="flex items-center gap-2">
              <Button variant="ghost" disabled={loading || data.page <= 1} onClick={() => onPageChange(data.page - 1)}><ChevronLeft className="size-4" />Anterior</Button>
              <span aria-current="page" className="rounded-lg border border-border px-3 py-1.5 text-foreground">{data.page}</span>
              <Button variant="ghost" disabled={loading || data.page * data.limit >= data.total} onClick={() => onPageChange(data.page + 1)}>Siguiente<ChevronRight className="size-4" /></Button>
            </nav>
          </div> : null}
        </>
      )}
    </section>
  );
}
