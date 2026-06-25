import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Configuración",
};

export default function SettingsPage() {
  return (
    <div>
      <PageHeading
        description="Revisa configuración operativa visible sin exponer secretos ni credenciales."
        title="Configuración"
      />
      <Card className="min-h-panel-min justify-center rounded-lg border border-border py-0 text-center shadow-sm ring-0">
        <CardContent className="p-5">
          <p className="text-lg font-bold">La configuración operativa aparecerá aquí.</p>
          <p className="mt-2 text-sm text-supporting">
            Esta pantalla concentrará ambiente, proveedores, scopes requeridos y enlaces a runbooks.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
