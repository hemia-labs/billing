import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { ServiceClientNewClient } from "@/features/billing/integrations/service-clients/service-client-new-client";

export const metadata: Metadata = { title: "Editar cliente autorizado" };

export default async function EditAuthorizedClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading
        title="Editar cliente autorizado"
        description="Actualiza el alcance y los orígenes de retorno de este cliente."
      />
      <ServiceClientNewClient key={clientId} clientId={clientId} />
    </div>
  );
}
