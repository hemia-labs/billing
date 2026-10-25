"use client";

import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { Badge } from "@/components/zuno/badge";
import { Button } from "@/components/zuno/button";
import { hasPermission, useSession } from "@/components/auth-gate";
import { integrationTypes } from "./integration-catalog";

export function IntegrationCatalogClient({ creating = false }: { creating?: boolean }) {
  const session = useSession();
  const canRead = hasPermission(session, "billing.integrations.read");
  const canManage = hasPermission(session, "billing.integrations.manage");

  if (!(creating ? canManage : canRead)) {
    return (
      <PageHeading
        title="Integraciones"
        description={`Necesitas billing.integrations.${creating ? "manage" : "read"} para acceder a esta sección.`}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading
        title={creating ? "Nueva integración" : "Integraciones"}
        description={creating
          ? "Elige el tipo de integración que quieres configurar."
          : "Administra las aplicaciones y servicios conectados con Billing."}
        actions={creating ? (
          <Button variant="outline" render={<Link href="/integrations" />}>
            Volver
          </Button>
        ) : canManage ? (
          <Button render={<Link href="/integrations/new" />}>
            Nueva integración
          </Button>
        ) : undefined}
      />

      <section aria-label="Tipos de integración" className="grid gap-4 md:grid-cols-2">
        {integrationTypes.map((item) => (
          <article
            key={item.key}
            aria-labelledby={`integration-${item.key}`}
            className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5 shadow-sm"
          >
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={`integration-${item.key}`} className="text-base font-semibold">{item.title}</h2>
                <Badge variant="outline">{item.availability}</Badge>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">{item.description}</p>
            </div>
            {creating ? item.key === "oauth" ? (
              <Button className="mt-auto w-fit" variant="outline" render={<Link href="/integrations/clients/new" />}>
                Configurar
              </Button>
            ) : null : (
              <Button className="mt-auto w-fit" variant="outline" render={<Link href={item.href} />}>
                {item.key === "oauth" || item.key === "events" ? "Administrar" : "Consultar"}
              </Button>
            )}
          </article>
        ))}
      </section>
      {creating && (
        <p className="text-sm text-muted-foreground">
          El registro desde esta pantalla está disponible para clientes OAuth. Las otras conexiones se consultan o administran en su sección correspondiente.
        </p>
      )}
    </div>
  );
}
