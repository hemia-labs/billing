"use client";

import { AlertCircle } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Alert, AlertDescription, AlertTitle } from "@/components/zuno/alert";
import { Button } from "@/components/zuno/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <PageHeading
        description="No pudimos mostrar esta sección de Billing."
        title="Error al cargar"
      />
      <Alert className="border-destructive/30 p-5" variant="destructive">
        <AlertCircle aria-hidden="true" className="size-5" />
        <AlertTitle>No fue posible cargar la información.</AlertTitle>
        <AlertDescription>
          Intenta nuevamente. Si el problema continúa, contacta al equipo de soporte.
        </AlertDescription>
        <Button className="mt-3 w-fit" onClick={reset} variant="outline">
          Reintentar
        </Button>
      </Alert>
    </div>
  );
}
