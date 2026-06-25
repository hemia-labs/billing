"use client";

import { type FormEvent, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  apiErrorMessage,
  apiFetch,
  redirectToLogin,
  toQueryString,
} from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AuditLog = {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  provider: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};
type Filters = {
  organization_id: string;
  resource_type: string;
  resource_id: string;
  actor_user_id: string;
  action: string;
  provider: string;
  created_from: string;
  created_to: string;
};
const emptyFilters: Filters = {
  organization_id: "",
  resource_type: "",
  resource_id: "",
  actor_user_id: "",
  action: "",
  provider: "",
  created_from: "",
  created_to: "",
};

export function AuditClient() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadLogs = async (nextFilters = filters) => {
    setLoading(true);
    setMessage("");
    try {
      const page = await apiFetch<{ items?: AuditLog[] }>(
        `/billing/console/audit${toQueryString(nextFilters)}`,
      );
      setLogs(page.items ?? []);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setMessage(apiErrorMessage(error, "No se pudo cargar la auditoría."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => loadLogs(emptyFilters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadLogs(filters);
  };

  return (
    <div className="space-y-5">
      <form className="grid gap-3 rounded-lg border border-border bg-card p-5 shadow-sm md:grid-cols-3 xl:grid-cols-8" onSubmit={submitFilters}>
        <Input aria-label="Organización" placeholder="Organización" value={filters.organization_id} onChange={(e) => setFilters({ ...filters, organization_id: e.target.value })} />
        <Input aria-label="Entidad" placeholder="Entidad" value={filters.resource_type} onChange={(e) => setFilters({ ...filters, resource_type: e.target.value })} />
        <Input aria-label="Resource ID" placeholder="Resource ID" value={filters.resource_id} onChange={(e) => setFilters({ ...filters, resource_id: e.target.value })} />
        <Input aria-label="Actor" placeholder="Actor" value={filters.actor_user_id} onChange={(e) => setFilters({ ...filters, actor_user_id: e.target.value })} />
        <Input aria-label="Evento" placeholder="Evento" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        <Input aria-label="Proveedor" placeholder="Proveedor" value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })} />
        <Input aria-label="Desde" type="date" value={filters.created_from} onChange={(e) => setFilters({ ...filters, created_from: e.target.value })} />
        <Button className="gap-2" type="submit"><Search className="size-4" />Filtrar</Button>
      </form>

      {message ? <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">{message}</div> : null}

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold">Audit logs</h2>
          <Button aria-label="Recargar auditoría" onClick={() => void loadLogs()} size="icon" variant="outline"><RefreshCw className="size-4" /></Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Evento</TableHead>
              <TableHead>Recurso</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Metadata</TableHead>
              <TableHead>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5}>Cargando auditoría...</TableCell></TableRow>
            ) : logs.length === 0 ? (
              <TableRow><TableCell colSpan={5}>No hay auditoría para mostrar.</TableCell></TableRow>
            ) : logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <div className="font-semibold">{log.action}</div>
                  <div className="text-xs text-muted-foreground">{log.provider ?? "sin proveedor"}</div>
                </TableCell>
                <TableCell>
                  <div>{log.resourceType}</div>
                  <div className="text-xs text-muted-foreground">{log.resourceId ?? "sin recurso"}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>Org {log.organizationId ?? "n/a"}</div>
                  <div>Actor {log.actorUserId ?? "sistema"}</div>
                </TableCell>
                <TableCell className="max-w-96 truncate text-xs text-muted-foreground">{JSON.stringify(log.metadata)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</TableCell>
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
