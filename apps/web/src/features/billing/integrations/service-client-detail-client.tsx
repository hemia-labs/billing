"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { hasPermission, useSession } from "@/components/auth-gate";
import { Badge } from "@/components/zuno/badge";
import { Button } from "@/components/zuno/button";
import { StatusBadge } from "@/components/zuno/status-badge";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/zuno/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import { listServiceClients, type ServiceClient } from "./service-clients-api";

type DetailTab = "products" | "organizations" | "return-origins";

export function ServiceClientDetailClient({ clientId, tab }: { clientId: string; tab: DetailTab }) {
  const router = useRouter();
  const session = useSession();
  const canRead = hasPermission(session, "billing.integrations.read");
  const canManage = hasPermission(session, "billing.integrations.manage");
  const [client, setClient] = useState<ServiceClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    listServiceClients(controller.signal)
      .then((clients) => {
        if (controller.signal.aborted) return;
        const found = clients.find((item) => item.clientId === clientId);
        if (found) setClient(found);
        else setError("El cliente autorizado no existe o ya no está disponible.");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setError(error instanceof ApiError && error.status === 429
          ? "Demasiadas solicitudes. Espera un momento e intenta de nuevo."
          : apiErrorMessage(error, "No se pudo cargar la integración."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canRead, clientId, revision]);

  if (!canRead) {
    return <p role="alert" className="rounded-xl border border-border bg-card p-5 text-sm text-destructive">No tienes permiso para consultar integraciones.</p>;
  }
  if (loading) {
    return <p role="status" className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Cargando integración…</p>;
  }
  if (!client) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <p role="alert" className="text-sm text-destructive">{error}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { setLoading(true); setError(""); setRevision((value) => value + 1); }}>Reintentar</Button>
          <Button variant="ghost" render={<Link href="/integrations/oauth" />}>Volver a clientes OAuth</Button>
        </div>
      </div>
    );
  }

  const baseHref = `/integrations/clients/${encodeURIComponent(client.clientId)}`;
  const restricted = client.organizationScope === "organizations";
  const organizations = client.organizationIds ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-all text-2xl font-semibold tracking-tight sm:text-3xl">{client.clientId}</h1>
            <StatusBadge status={client.enabled ? "success" : "neutral"}>{client.enabled ? "Habilitado" : "Deshabilitado"}</StatusBadge>
            <Badge variant="outline">Cliente de Identity</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Autorización de acceso a Billing. Los permisos OAuth se administran en Identity.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {client.clientId !== "balanz-billing-service" && (
            <Button variant="outline" render={<Link href="/integrations/oauth" />}><ArrowLeft className="size-4" />Volver</Button>
          )}
          {canManage && <Button render={<Link href={`${baseHref}/edit`} />}><Pencil className="size-4" />Editar</Button>}
        </div>
      </header>

      <Tabs className="gap-4" variant="underline" value={tab} onValueChange={(value) => {
        if (value === "products" || value === "organizations" || value === "return-origins") {
          router.push(value === "products" ? baseHref : `${baseHref}?tab=${value}`, { scroll: false });
        }
      }}>
        <TabsList className="w-full flex-wrap gap-x-4 gap-y-0" aria-label="Detalle de la integración">
          <TabsTab className="min-h-10 px-3" value="products">Productos <span className="ml-1 text-muted-foreground">({client.products.length})</span></TabsTab>
          <TabsTab className="min-h-10 px-3" value="organizations">Organizaciones {restricted && <span className="ml-1 text-muted-foreground">({organizations.length})</span>}</TabsTab>
          <TabsTab className="min-h-10 px-3" value="return-origins">Orígenes de retorno <span className="ml-1 text-muted-foreground">({client.allowedReturnOrigins.length})</span></TabsTab>
        </TabsList>
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <div className="min-w-0">
            <TabsPanel className="mt-0" value="products">
              <AccessTable title="Productos permitidos" description="El cliente puede acceder únicamente a estos productos." column="Código de producto" entries={client.products} emptyMessage="Sin productos configurados." />
            </TabsPanel>
            <TabsPanel className="mt-0" value="organizations">
              <AccessTable title="Organizaciones permitidas" description={restricted ? "El acceso está limitado a las siguientes organizaciones." : "El cliente tiene acceso a todas las organizaciones de los productos permitidos."} column="UUID de organización" entries={restricted ? organizations : []} emptyMessage={restricted ? "Sin organizaciones configuradas." : "Todas las organizaciones de los productos permitidos."} />
            </TabsPanel>
            <TabsPanel className="mt-0" value="return-origins">
              <AccessTable title="Orígenes de retorno" description="Orígenes autorizados para las URLs de éxito y cancelación del checkout." column="Origen permitido" entries={client.allowedReturnOrigins} emptyMessage="Sin orígenes de retorno configurados." />
            </TabsPanel>
          </div>
          <aside className="min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Detalles de la integración</h2>
            <dl className="mt-3 divide-y divide-border text-sm">
              <div className="py-3"><dt className="text-muted-foreground">Cliente de Identity</dt><dd className="mt-1 break-all font-mono text-xs">{client.clientId}</dd></div>
              <div className="py-3"><dt className="text-muted-foreground">Alcance de organizaciones</dt><dd className="mt-1 font-medium">{restricted ? "Organizaciones específicas" : "Todas las de los productos permitidos"}</dd></div>
              <div className="py-3"><dt className="text-muted-foreground">Checkouts compartidos</dt><dd className="mt-1 font-medium">{client.allowSharedCheckouts ? "Permitidos" : "No permitidos"}</dd></div>
              <div className="py-3"><dt className="text-muted-foreground">Origen de la configuración</dt><dd className="mt-1 font-medium">{client.source === "database" ? "Registro de Billing" : "Configuración del entorno"}</dd></div>
            </dl>
          </aside>
        </div>
      </Tabs>
    </div>
  );
}

function AccessTable({ title, description, column, entries, emptyMessage }: {
  title: string;
  description: string;
  column: string;
  entries: string[];
  emptyMessage: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="h-10 px-5 text-xs font-medium text-muted-foreground">{column}</TableHead></TableRow></TableHeader>
          <TableBody>
            {entries.length ? entries.map((entry) => (
              <TableRow className="h-12 hover:bg-muted/30" key={entry}><TableCell className="break-all px-5 font-mono text-xs">{entry}</TableCell></TableRow>
            )) : <TableRow><TableCell className="h-24 px-5 text-center text-muted-foreground">{emptyMessage}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
