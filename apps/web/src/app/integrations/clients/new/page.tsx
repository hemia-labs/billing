import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { ServiceClientNewClient } from "@/features/billing/integrations/service-client-new-client";

export const metadata: Metadata = { title: "Nuevo cliente autorizado" };

export default function NewAuthorizedClientPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading
        title="Nuevo cliente autorizado"
        description="Autoriza un cliente de Identity para consumir Billing y define su alcance de acceso."
      />
      <ServiceClientNewClient />
    </div>
  );
}
