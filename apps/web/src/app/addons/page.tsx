import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Add-ons",
};

export default function AddonsPage() {
  return (
    <div>
      <PageHeading
        description="Opera add-ons recurrentes asociados a suscripciones existentes."
        title="Add-ons"
      />
      <Card className="min-h-panel-min justify-center rounded-lg border border-border py-0 text-center shadow-sm ring-0">
        <CardContent className="p-5">
          <p className="text-lg font-bold">La operación de add-ons aparecerá aquí.</p>
          <p className="mt-2 text-sm text-supporting">
            Esta sección habilitará altas, cantidades, aprobación pendiente y baja programada.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
