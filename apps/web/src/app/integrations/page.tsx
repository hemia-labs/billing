import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Integraciones",
};

export default function IntegrationsPage() {
  return (
    <div>
      <PageHeading
        description="Consulta contratos y límites de integración para productos Hemia."
        title="Integraciones"
      />
      <Card className="min-h-panel-min justify-center rounded-lg border border-border py-0 text-center shadow-sm ring-0">
        <CardContent className="p-5">
          <p className="text-lg font-bold">Los contratos de integración aparecerán aquí.</p>
          <p className="mt-2 text-sm text-supporting">
            Esta sección documentará clientes, scopes y contratos server-to-server versionados.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
