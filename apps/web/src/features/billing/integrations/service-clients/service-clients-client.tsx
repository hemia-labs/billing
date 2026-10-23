"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Filter, MoreHorizontal, Pencil, Eye } from "lucide-react";
import { hasPermission, useSession } from "@/components/auth-gate";
import { Input } from "@/components/zuno/input";
import { StatusBadge } from "@/components/zuno/status-badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/zuno/dropdown-menu";
import { Button } from "@/components/zuno/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  listServiceClients,
  type ServiceClient,
} from "./service-clients-api";

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 429)
    return "Demasiadas solicitudes. Espera un momento e intenta de nuevo.";
  return apiErrorMessage(
    error,
    "No se pudo completar la operación. Intenta de nuevo.",
  );
}

export function ServiceClientsClient() {
  const session = useSession();
  const canRead = hasPermission(session, "billing.integrations.read");
  const canManage = hasPermission(session, "billing.integrations.manage");
  const [clients, setClients] = useState<ServiceClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const filteredClients = clients.filter((client) =>
    (status === "all" || client.enabled === (status === "enabled")) &&
    [client.clientId, ...client.products, ...client.allowedReturnOrigins].some((value) => value.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    listServiceClients(controller.signal)
      .then((clients) => {
        if (!controller.signal.aborted) setClients(clients);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canRead, revision]);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Clientes OAuth</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Administra qué aplicaciones de Identity pueden consumir Billing y el alcance de su autorización.</p>
        </div>
        {canManage && (
          <Button className="w-fit shrink-0" render={<Link href="/integrations/clients/new" />}>
            <Plus className="size-4" />Registrar cliente OAuth
          </Button>
        )}
      </header>
          {!canRead ? (
            <p role="alert">No tienes permiso para consultar integraciones.</p>
          ) : (
            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <span aria-live="polite" className="text-sm text-muted-foreground">
                  {loading ? "Cargando…" : `${filteredClients.length} ${filteredClients.length === 1 ? "cliente" : "clientes"}`}
                </span>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative w-full sm:w-72">
                    <label className="sr-only" htmlFor="clients-search">Buscar por cliente, producto u origen</label>
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="clients-search" className="pl-10 text-sm" placeholder="Buscar" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button className="w-full justify-center gap-2 px-4 sm:w-auto" variant="outline" />}>
                      <Filter className="size-4" />Filtros{status === "all" ? "" : " (1)"}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                      <DropdownMenuRadioGroup aria-label="Estado" value={status} onValueChange={setStatus}>
                        <DropdownMenuRadioItem value="all">Todos los estados</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="enabled">Habilitados</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="disabled">Deshabilitados</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {loading ? (
                <p className="border-t border-border p-5 text-sm text-muted-foreground" role="status">
                  Cargando clientes…
                </p>
              ) : error ? (
                <div className="border-t border-border p-5">
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    onClick={() => {
                      setLoading(true);
                      setError("");
                      setRevision((value) => value + 1);
                    }}
                  >
                    Reintentar
                  </Button>
                  <Button
                    className="ml-2"
                    variant="ghost"
                    onClick={() => redirectToLogin()}
                  >
                    Iniciar sesión
                  </Button>
                </div>
              ) : !clients.length ? (
                <p className="border-t border-border p-5 text-sm text-muted-foreground">
                  Aún no hay clientes registrados. Registra el client_id de
                  Identity para autorizar su acceso a Billing.
                </p>
              ) : (
                <div className="overflow-x-auto border-t border-border">
                  <Table className="min-w-[800px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-10 px-5 text-xs font-medium text-muted-foreground">Cliente de Identity</TableHead>
                        <TableHead className="text-xs font-medium text-muted-foreground">Productos</TableHead>
                        <TableHead className="text-xs font-medium text-muted-foreground">Organizaciones</TableHead>
                        <TableHead className="text-xs font-medium text-muted-foreground">Orígenes de retorno</TableHead>
                        <TableHead className="text-xs font-medium text-muted-foreground">Estado</TableHead>
                        <TableHead className="w-14 px-5 text-right"><span className="sr-only">Acciones</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!filteredClients.length && (
                        <TableRow><TableCell colSpan={6} className="h-24 px-5 text-center text-muted-foreground">No hay clientes que coincidan con la búsqueda o los filtros.</TableCell></TableRow>
                      )}
                      {filteredClients.map((client) => (
                        <TableRow className="h-12 hover:bg-muted/30" key={client.clientId}>
                          <TableCell className="max-w-60 break-all px-5 font-medium">
                            <Link className="block font-semibold text-foreground hover:underline" href={`/integrations/clients/${encodeURIComponent(client.clientId)}`}>{client.clientId}</Link>
                          </TableCell>
                          <TableCell className="max-w-48 break-words">
                            {client.products.join(", ")}
                          </TableCell>
                          <TableCell>
                            {client.organizationScope === "organizations"
                              ? `${client.organizationIds?.length ?? 0} permitidas`
                              : "Todas las del producto"}
                          </TableCell>
                          <TableCell className="max-w-72 break-all">
                            {client.allowedReturnOrigins.length
                              ? client.allowedReturnOrigins.join(", ")
                              : "Sin configurar"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={client.enabled ? "success" : "neutral"}>
                              {client.enabled ? "Habilitado" : "Deshabilitado"}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="px-5 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger render={<Button aria-label={`Acciones de ${client.clientId}`} className="size-8" size="icon" variant="ghost" />}>
                                <MoreHorizontal className="size-4" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="min-w-40">
                                <DropdownMenuItem render={<Link href={`/integrations/clients/${encodeURIComponent(client.clientId)}`} />}>
                                  <Eye className="size-4" />Ver detalle
                                </DropdownMenuItem>
                                {canManage && <DropdownMenuItem render={<Link href={`/integrations/clients/${encodeURIComponent(client.clientId)}/edit`} />}>
                                  <Pencil className="size-4" />Editar
                                </DropdownMenuItem>}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          )}
    </div>
  );
}
