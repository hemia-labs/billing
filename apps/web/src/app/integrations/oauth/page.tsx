import type { Metadata } from "next";
import { ServiceClientsClient } from "@/features/billing/integrations/service-clients-client";

export const metadata: Metadata = { title: "Clientes OAuth" };

export default function OAuthIntegrationsPage() {
  return <ServiceClientsClient />;
}
