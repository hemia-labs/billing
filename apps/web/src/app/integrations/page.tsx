import type { Metadata } from "next";
import { IntegrationCatalogClient } from "@/features/billing/integrations/catalog/integration-catalog-client";

export const metadata: Metadata = { title: "Integraciones" };

export default function IntegrationsPage() {
  return <IntegrationCatalogClient />;
}
