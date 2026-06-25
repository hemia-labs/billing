import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Operación",
};

export default function OperationsPage() {
  return (
    <div>
      <PageHeading
        description="Diagnostica suscripciones, checkouts y licencias por organización."
        title="Operación"
      />
      <Card className="min-h-panel-min justify-center rounded-lg border border-border py-0 text-center shadow-sm ring-0">
        <CardContent className="p-5">
          <p className="text-lg font-bold">La operación comercial aparecerá aquí.</p>
          <p className="mt-2 text-sm text-supporting">
            Esta sección concentrará búsquedas, detalles y verificación manual de checkouts.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
