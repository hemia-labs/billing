"use client";

import Link from "next/link";
import { ArrowUpRight, CreditCard, Fingerprint, Scale, Settings2, Webhook } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Badge } from "@/components/zuno/badge";
import { Button } from "@/components/zuno/button";
import { Card, CardContent, CardFooter } from "@/components/zuno/card";
import { hasPermission, useSession } from "@/components/auth-gate";
import { visibleIntegrationTypes } from "./integration-catalog";

const integrationIcons = { oauth: Fingerprint, legal: Scale, payments: CreditCard, events: Webhook };

export function IntegrationCatalogClient({ creating = false }: { creating?: boolean }) {
  const session = useSession();
  const items = visibleIntegrationTypes(session.permissions ?? [], creating);
  const canManage = hasPermission(session, "billing.integrations.manage");

  const canConfigurePayments = hasPermission(session, "billing.catalog.read") && hasPermission(session, "billing.catalog.manage");

  if (!items.length) {
    return (
      <PageHeading
        title="Integraciones"
        description="No tienes permiso para acceder a las integraciones disponibles."
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
        ) : canManage || canConfigurePayments ? (
          <Button render={<Link href="/integrations/new" />}>
            Nueva integración
          </Button>
        ) : undefined}
      />

      <section aria-label="Tipos de integración" className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = integrationIcons[item.key];
          const configurable = item.key === "oauth" ? canManage : item.key === "payments" && canConfigurePayments;
          const href = creating && item.key === "oauth" ? "/integrations/clients/new" : item.href;
          return (
            <Card
              key={item.key}
              aria-labelledby={`integration-${item.key}`}
              className="flex min-w-0 flex-col overflow-hidden rounded-lg shadow-sm"
              role="article"
            >
              <CardContent className="flex-1 p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-primary">
                    <Icon aria-hidden="true" className="size-6" />
                  </span>
                  <Button aria-label={`Abrir ${item.title}`} size="icon" variant="ghost" render={<Link href={item.href} />}>
                    <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
                  </Button>
                </div>
                <h2 id={`integration-${item.key}`} className="mt-4 text-base font-semibold">{item.title}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
              </CardContent>
              <CardFooter className="min-h-16 flex-wrap justify-between gap-3 border-t border-border px-5 py-3">
                {!creating || item.key === "oauth" || item.key === "payments" ? (
                  <Button variant="outline" render={<Link href={href} />}>
                    <Settings2 aria-hidden="true" className="size-4" />
                    {configurable ? "Configurar" : "Consultar"}
                  </Button>
                ) : null}
                <Badge className="ml-auto" variant="outline">{item.availability}</Badge>
              </CardFooter>
            </Card>
          );
        })}
      </section>
      {creating && (
        <p className="text-sm text-muted-foreground">
          Puedes configurar clientes OAuth y conexiones PayPal según tus permisos. Las otras conexiones se consultan en su sección correspondiente.
        </p>
      )}
    </div>
  );
}
