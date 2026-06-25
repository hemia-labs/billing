import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Catálogo",
};

export default function CatalogPage() {
  return (
    <div>
      <PageHeading
        description="Administra productos, planes y add-ons publicados por Billing Core."
        title="Catálogo"
      />
      <Card className="min-h-panel-min justify-center rounded-lg border border-border py-0 text-center shadow-sm ring-0">
        <CardContent className="p-5">
          <p className="text-lg font-bold">El catálogo administrativo aparecerá aquí.</p>
          <p className="mt-2 text-sm text-supporting">
            Esta sección habilitará listados y edición de productos, planes y add-ons.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
