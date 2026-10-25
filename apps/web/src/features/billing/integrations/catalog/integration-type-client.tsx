"use client";

import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/zuno/button";
import { hasPermission, useSession } from "@/components/auth-gate";

const typeDetails = {
  legal: {
    title: "Hemia Legal",
    description: "Conexión de Billing con Legal para verificar la aceptación de documentos antes de completar el checkout.",
    sections: [
      ["Autenticación", "Billing obtiene tokens OAuth de servicio para comunicarse con Legal. El secreto permanece en la configuración privada del backend."],
      ["Vinculación de productos", "Cada producto puede asociarse con sus identificadores legales y, cuando aplica, con el origen de identidad externa."],
      ["Validación", "Antes de crear el checkout, Billing solicita a Legal comprobar que la aceptación corresponde al comprador y a los documentos vigentes."],
    ],
  },
  payments: {
    title: "Proveedores de pago",
    description: "Servicios que Billing usa para crear checkouts y administrar suscripciones.",
    sections: [
      ["PayPal", "El flujo de checkout y administración de suscripciones está integrado con PayPal."],
      ["Credenciales", "El client ID, el secreto y el ambiente se administran en la configuración privada del backend."],
      ["Alcance actual", "La pantalla de integraciones informa sobre el proveedor. La conexión no se edita desde este formulario."],
    ],
  },
  events: {
    title: "Eventos y webhooks",
    description: "Notificaciones de proveedores que actualizan pagos y suscripciones en Billing.",
    sections: [
      ["Eventos de PayPal", "Billing recibe notificaciones, verifica su autenticidad y aplica los cambios correspondientes a las suscripciones."],
      ["Operación", "Consulta el historial y el estado de procesamiento en la sección de webhooks."],
    ],
  },
} as const;

type DetailType = keyof typeof typeDetails;

export function IntegrationTypeClient({ type }: { type: DetailType }) {
  const session = useSession();
  const canRead = hasPermission(session, "billing.integrations.read");
  const detail = typeDetails[type];

  if (!canRead) {
    return <PageHeading title="Integraciones" description="No tienes permiso para consultar integraciones." />;
  }

  return (
    <div className="space-y-6">
      <PageHeading
        title={detail.title}
        description={detail.description}
        actions={<Button variant="outline" render={<Link href="/integrations" />}>Volver</Button>}
      />
      <section aria-label={`Detalles de ${detail.title}`} className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {detail.sections.map(([title, description]) => (
          <div key={title} className="grid gap-2 p-5 sm:grid-cols-[minmax(10rem,0.7fr)_2fr] sm:gap-6">
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        ))}
      </section>
      {type === "events" && hasPermission(session, "billing.webhooks.read") && (
        <Button render={<Link href="/webhooks" />}>Administrar webhooks</Button>
      )}
    </div>
  );
}
